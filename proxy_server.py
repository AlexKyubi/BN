#!/usr/bin/env python3
"""Sulpak stock proxy with SQLite as single source of truth.

Endpoints:
- GET /health
- GET /region-stock?cityId=1&languageId=3[&since=123]
- GET /stock?cityId=1&article=628340&languageId=3[&userId=...]
"""

from __future__ import annotations

import csv
import hashlib
import json
import logging
import os
import re
import sqlite3
import threading
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime
from html import unescape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlencode, urlparse
from urllib.request import Request, urlopen


@dataclass
class ServerConfig:
	host: str
	port: int
	allowed_origins: list[str]
	rate_limit_max: int
	rate_limit_window: float
	db_path: str
	log_path: str
	tracked_csv_url: str
	tracked_csv_path: str
	tracked_csv_article_column: int
	regions_file_path: str
	default_language_id: str
	stock_ttl_seconds: int
	background_start_hour: int
	background_end_hour: int
	background_cycle_seconds: int
	background_off_hours_sleep_seconds: int
	background_min_interval_seconds: float
	retry_delay_seconds: int
	upstream_timeout_seconds: int
	view_retention_seconds: int
	view_cleanup_interval_seconds: int
	backup_dir: str
	backup_retention_days: int
	backup_hour: int
	maintenance_poll_seconds: int
	tracked_csv_refresh_seconds: int
	wal_autocheckpoint_pages: int

	@classmethod
	def load(cls) -> "ServerConfig":
		config_path = Path(os.environ.get("SERVER_CONFIG_PATH", "server_config.json")).resolve()
		payload: dict[str, Any] = {}
		if config_path.exists():
			payload = json.loads(config_path.read_text(encoding="utf-8"))

		def read(key: str, env_key: str, default: Any) -> Any:
			if env_key in os.environ:
				return os.environ[env_key]
			return payload.get(key, default)

		allowed = str(
			read(
				"allowed_origins",
				"ALLOWED_ORIGINS",
				"https://bn.alexkyubi.com,http://127.0.0.1:5500,http://localhost:5500",
			)
		)

		return cls(
			host=str(read("host", "HOST", "0.0.0.0")),
			port=int(read("port", "PORT", 8080)),
			allowed_origins=[origin.strip() for origin in allowed.split(",") if origin.strip()],
			rate_limit_max=int(read("rate_limit_max", "RATE_LIMIT_MAX", 3000)),
			rate_limit_window=float(read("rate_limit_window", "RATE_LIMIT_WINDOW", 60)),
			db_path=str(read("db_path", "SQLITE_PATH", "data/sulpak_cache.sqlite3")),
			log_path=str(read("log_path", "LOG_PATH", "logs/proxy_server.log")),
			tracked_csv_url=str(read("tracked_csv_url", "TRACKED_CSV_URL", "")).strip(),
			tracked_csv_path=str(read("tracked_csv_path", "TRACKED_CSV_PATH", "public/products.csv")).strip(),
			tracked_csv_article_column=max(1, int(read("tracked_csv_article_column", "TRACKED_CSV_ARTICLE_COLUMN", 3))),
			regions_file_path=str(read("regions_file_path", "REGIONS_FILE_PATH", "data/sulpak.region.codes.json")).strip(),
			default_language_id=str(read("default_language_id", "DEFAULT_LANGUAGE_ID", "3")).strip(),
			stock_ttl_seconds=max(60, int(read("stock_ttl_seconds", "STOCK_TTL_SECONDS", 3 * 60 * 60))),
			background_start_hour=max(0, min(23, int(read("background_start_hour", "BACKGROUND_START_HOUR", 6)))),
			background_end_hour=max(0, min(23, int(read("background_end_hour", "BACKGROUND_END_HOUR", 22)))),
			background_cycle_seconds=max(600, int(read("background_cycle_seconds", "BACKGROUND_CYCLE_SECONDS", 3 * 60 * 60))),
			background_off_hours_sleep_seconds=max(
				10,
				int(read("background_off_hours_sleep_seconds", "BACKGROUND_OFF_HOURS_SLEEP_SECONDS", 120)),
			),
			background_min_interval_seconds=max(
				0.05,
				float(read("background_min_interval_seconds", "BACKGROUND_MIN_INTERVAL_SECONDS", 1.0)),
			),
			retry_delay_seconds=max(60, int(read("retry_delay_seconds", "RETRY_DELAY_SECONDS", 15 * 60))),
			upstream_timeout_seconds=max(5, int(read("upstream_timeout_seconds", "UPSTREAM_TIMEOUT_SECONDS", 10))),
			view_retention_seconds=max(60, int(read("view_retention_seconds", "VIEW_RETENTION_SECONDS", 7 * 24 * 60 * 60))),
			view_cleanup_interval_seconds=max(
				60,
				int(read("view_cleanup_interval_seconds", "VIEW_CLEANUP_INTERVAL_SECONDS", 60 * 60)),
			),
			backup_dir=str(read("backup_dir", "BACKUP_DIR", "backups")).strip(),
			backup_retention_days=max(1, int(read("backup_retention_days", "BACKUP_RETENTION_DAYS", 14))),
			backup_hour=max(0, min(23, int(read("backup_hour", "BACKUP_HOUR", 3)))),
			maintenance_poll_seconds=max(30, int(read("maintenance_poll_seconds", "MAINTENANCE_POLL_SECONDS", 300))),
			tracked_csv_refresh_seconds=max(60, int(read("tracked_csv_refresh_seconds", "TRACKED_CSV_REFRESH_SECONDS", 900))),
			wal_autocheckpoint_pages=max(100, int(read("wal_autocheckpoint_pages", "WAL_AUTOCHECKPOINT_PAGES", 1000))),
		)


CONFIG = ServerConfig.load()


def setup_logging(log_path: str) -> logging.Logger:
	path = Path(log_path)
	path.parent.mkdir(parents=True, exist_ok=True)

	logger = logging.getLogger("sulpak_proxy")
	logger.setLevel(logging.INFO)
	logger.handlers.clear()

	formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
	file_handler = RotatingFileHandler(path, maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8")
	file_handler.setFormatter(formatter)
	stream_handler = logging.StreamHandler()
	stream_handler.setFormatter(formatter)

	logger.addHandler(file_handler)
	logger.addHandler(stream_handler)
	return logger


LOGGER = setup_logging(CONFIG.log_path)


class UpstreamError(Exception):
	def __init__(self, code: str, status: int, body: str = "") -> None:
		super().__init__(code)
		self.code = code
		self.status = status
		self.body = body


class SingleFlight:
	class _Flight:
		def __init__(self) -> None:
			self.event = threading.Event()
			self.result: Any = None
			self.error: Exception | None = None

	def __init__(self) -> None:
		self._lock = threading.Lock()
		self._inflight: dict[str, SingleFlight._Flight] = {}

	def run(self, key: str, fn: Callable[[], Any]) -> tuple[Any, bool]:
		with self._lock:
			flight = self._inflight.get(key)
			is_owner = flight is None
			if is_owner:
				flight = SingleFlight._Flight()
				self._inflight[key] = flight

		assert flight is not None
		if is_owner:
			try:
				flight.result = fn()
			except Exception as exc:  # pylint: disable=broad-except
				flight.error = exc
			finally:
				flight.event.set()
				with self._lock:
					self._inflight.pop(key, None)
		else:
			flight.event.wait()

		if flight.error is not None:
			raise flight.error
		return flight.result, is_owner


class SQLiteStore:
	def __init__(self, db_path: str) -> None:
		self.db_path = Path(db_path).resolve()
		self.db_path.parent.mkdir(parents=True, exist_ok=True)
		self._lock = threading.RLock()
		self._conn = sqlite3.connect(self.db_path, check_same_thread=False, isolation_level=None)
		self._conn.row_factory = sqlite3.Row
		journal_mode = self._conn.execute("PRAGMA journal_mode=WAL").fetchone()[0]
		self._conn.execute("PRAGMA synchronous=NORMAL")
		self._conn.execute("PRAGMA temp_store=MEMORY")
		self._conn.execute("PRAGMA foreign_keys=ON")
		self._conn.execute(f"PRAGMA wal_autocheckpoint={CONFIG.wal_autocheckpoint_pages}")
		self._conn.execute("PRAGMA busy_timeout=30000")
		self._init_schema()
		LOGGER.info("sqlite_open db=%s journal_mode=%s synchronous=NORMAL wal_autocheckpoint=%s", self.db_path, journal_mode, CONFIG.wal_autocheckpoint_pages)

	def _init_schema(self) -> None:
		with self._lock:
			self._conn.executescript(
				"""
				CREATE TABLE IF NOT EXISTS tracked_articles (
					article TEXT PRIMARY KEY,
					title TEXT DEFAULT ''
				);

				CREATE TABLE IF NOT EXISTS regions (
					region_id INTEGER PRIMARY KEY,
					city TEXT NOT NULL,
					region TEXT NOT NULL
				);

				CREATE TABLE IF NOT EXISTS region_state (
					region_id INTEGER PRIMARY KEY,
					initialized_at INTEGER,
					last_bootstrap_at INTEGER,
					updated_at INTEGER,
					FOREIGN KEY(region_id) REFERENCES regions(region_id)
				);

				CREATE TABLE IF NOT EXISTS stock_records (
					region_id INTEGER NOT NULL,
					article TEXT NOT NULL,
					language_id TEXT NOT NULL,
					product_code TEXT,
					product_title TEXT,
					city_title TEXT,
					price REAL,
					price_old REAL,
					count INTEGER NOT NULL DEFAULT 0,
					stores_json TEXT NOT NULL DEFAULT '[]',
					exact_match INTEGER NOT NULL DEFAULT 0,
					message TEXT,
					source TEXT,
					search_source TEXT,
					updated_at INTEGER,
					last_success_at INTEGER,
					last_attempt_at INTEGER,
					last_error TEXT,
					sync_token INTEGER NOT NULL DEFAULT 0,
					PRIMARY KEY(region_id, article),
					FOREIGN KEY(region_id) REFERENCES regions(region_id),
					FOREIGN KEY(article) REFERENCES tracked_articles(article)
				);

				CREATE TABLE IF NOT EXISTS refresh_queue (
					region_id INTEGER NOT NULL,
					article TEXT NOT NULL,
					next_retry_at INTEGER NOT NULL,
					processing INTEGER NOT NULL DEFAULT 0,
					reason TEXT,
					attempts INTEGER NOT NULL DEFAULT 0,
					updated_at INTEGER NOT NULL,
					PRIMARY KEY(region_id, article)
				);

				CREATE TABLE IF NOT EXISTS view_events (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					region_id INTEGER NOT NULL,
					article TEXT NOT NULL,
					user_hash TEXT NOT NULL,
					viewed_at INTEGER NOT NULL
				);

				CREATE INDEX IF NOT EXISTS idx_stock_article_region ON stock_records(article, region_id);
				CREATE INDEX IF NOT EXISTS idx_stock_updated_at ON stock_records(updated_at);
				CREATE INDEX IF NOT EXISTS idx_stock_last_success ON stock_records(last_success_at);
				CREATE INDEX IF NOT EXISTS idx_stock_sync_token ON stock_records(region_id, sync_token);
				CREATE INDEX IF NOT EXISTS idx_refresh_queue_processing_next_retry ON refresh_queue(processing, next_retry_at);
				CREATE INDEX IF NOT EXISTS idx_views_lookup ON view_events(article, region_id, viewed_at);
				CREATE INDEX IF NOT EXISTS idx_views_article_viewed_at ON view_events(article, viewed_at);
				CREATE INDEX IF NOT EXISTS idx_views_viewed_at ON view_events(viewed_at);

				CREATE TABLE IF NOT EXISTS meta (
					key TEXT PRIMARY KEY,
					value TEXT NOT NULL
				);

				INSERT OR IGNORE INTO meta(key, value) VALUES ('global_sync_token', '0');
				INSERT OR IGNORE INTO meta(key, value) VALUES ('last_view_cleanup_at', '0');
				INSERT OR IGNORE INTO meta(key, value) VALUES ('last_backup_date', '');
				INSERT OR IGNORE INTO meta(key, value) VALUES ('last_tracked_csv_refresh_at', '0');
				"""
			)
			columns = {
				str(row["name"]): row
				for row in self._conn.execute("PRAGMA table_info(refresh_queue)").fetchall()
			}
			if "processing" not in columns:
				self._conn.execute("ALTER TABLE refresh_queue ADD COLUMN processing INTEGER NOT NULL DEFAULT 0")

	def _get_meta_int(self, key: str, default: int = 0) -> int:
		row = self._conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
		if row is None:
			return default
		try:
			return int(str(row[0]))
		except (TypeError, ValueError):
			return default

	def _set_meta(self, key: str, value: str) -> None:
		self._conn.execute(
			"INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
			(key, value),
		)

	def _next_sync_token_locked(self) -> int:
		current = int(self._conn.execute("SELECT value FROM meta WHERE key = 'global_sync_token'").fetchone()[0])
		current += 1
		self._conn.execute("UPDATE meta SET value = ? WHERE key = 'global_sync_token'", (str(current),))
		return current

	def replace_tracked_articles(self, articles: set[str]) -> None:
		with self._lock:
			self._conn.execute("BEGIN")
			try:
				self._conn.execute("DELETE FROM tracked_articles")
				self._conn.executemany(
					"INSERT INTO tracked_articles(article, title) VALUES (?, '')",
					[(article,) for article in sorted(articles)],
				)
				self._conn.execute("COMMIT")
			except Exception:
				self._conn.execute("ROLLBACK")
				raise

	def sync_tracked_articles(self, articles: set[str]) -> tuple[int, int]:
		if not articles:
			return (0, 0)
		inserted = 0
		deleted = 0
		with self._lock:
			self._conn.execute("BEGIN")
			try:
				rows = self._conn.execute("SELECT article FROM tracked_articles").fetchall()
				current = {str(row["article"]) for row in rows}
				to_add = set(articles) - current
				to_remove = current - set(articles)

				if to_remove:
					params = [(article,) for article in to_remove]
					self._conn.executemany("DELETE FROM refresh_queue WHERE article = ?", params)
					self._conn.executemany("DELETE FROM stock_records WHERE article = ?", params)
					self._conn.executemany("DELETE FROM view_events WHERE article = ?", params)
					self._conn.executemany("DELETE FROM tracked_articles WHERE article = ?", params)
					deleted = len(to_remove)

				for article in sorted(to_add):
					cursor = self._conn.execute(
						"INSERT OR IGNORE INTO tracked_articles(article, title) VALUES (?, '')",
						(article,),
					)
					if int(cursor.rowcount or 0) > 0:
						inserted += 1
				self._conn.execute("COMMIT")
			except Exception:
				self._conn.execute("ROLLBACK")
				raise
		return (inserted, deleted)

	def replace_regions(self, regions: list[dict[str, Any]]) -> None:
		with self._lock:
			self._conn.execute("BEGIN")
			try:
				self._conn.execute("DELETE FROM regions")
				self._conn.executemany(
					"INSERT INTO regions(region_id, city, region) VALUES (?, ?, ?)",
					[
						(
							int(item["id"]),
							str(item["city"]),
							str(item["region"]),
						)
						for item in regions
					],
				)
				self._conn.execute("COMMIT")
			except Exception:
				self._conn.execute("ROLLBACK")
				raise

	def sync_regions(self, regions: list[dict[str, Any]]) -> tuple[int, int, int]:
		"""Sync regions without violating FKs.

		Returns (inserted, updated, deleted).
		"""
		if not regions:
			return (0, 0, 0)

		incoming: dict[int, tuple[str, str]] = {}
		for item in regions:
			region_id = int(item["id"])
			city = str(item["city"])
			region = str(item["region"])
			incoming[region_id] = (city, region)

		inserted = 0
		updated = 0
		deleted = 0
		with self._lock:
			self._conn.execute("BEGIN")
			try:
				rows = self._conn.execute("SELECT region_id, city, region FROM regions").fetchall()
				current = {int(row["region_id"]): (str(row["city"]), str(row["region"])) for row in rows}

				to_add = set(incoming.keys()) - set(current.keys())
				to_remove = set(current.keys()) - set(incoming.keys())
				to_check = set(incoming.keys()) & set(current.keys())

				if to_remove:
					params = [(region_id,) for region_id in sorted(to_remove)]
					self._conn.executemany("DELETE FROM refresh_queue WHERE region_id = ?", params)
					self._conn.executemany("DELETE FROM stock_records WHERE region_id = ?", params)
					self._conn.executemany("DELETE FROM view_events WHERE region_id = ?", params)
					self._conn.executemany("DELETE FROM region_state WHERE region_id = ?", params)
					self._conn.executemany("DELETE FROM regions WHERE region_id = ?", params)
					deleted = len(to_remove)

				for region_id in sorted(to_add):
					city, region = incoming[region_id]
					cursor = self._conn.execute(
						"INSERT INTO regions(region_id, city, region) VALUES (?, ?, ?)",
						(region_id, city, region),
					)
					if int(cursor.rowcount or 0) > 0:
						inserted += 1

				for region_id in sorted(to_check):
					city, region = incoming[region_id]
					if current[region_id] == (city, region):
						continue
					cursor = self._conn.execute(
						"UPDATE regions SET city = ?, region = ? WHERE region_id = ?",
						(city, region, region_id),
					)
					if int(cursor.rowcount or 0) > 0:
						updated += 1

				self._conn.execute("COMMIT")
			except Exception:
				self._conn.execute("ROLLBACK")
				raise

		return (inserted, updated, deleted)

	def get_tracked_articles(self) -> list[str]:
		rows = self._conn.execute("SELECT article FROM tracked_articles ORDER BY article").fetchall()
		return [str(row["article"]) for row in rows]

	def has_tracked_article(self, article: str) -> bool:
		row = self._conn.execute("SELECT 1 FROM tracked_articles WHERE article = ?", (article,)).fetchone()
		return row is not None

	def get_region(self, region_id: int) -> dict[str, Any] | None:
		row = self._conn.execute(
			"SELECT region_id, city, region FROM regions WHERE region_id = ?",
			(region_id,),
		).fetchone()
		if row is None:
			return None
		return {"id": int(row["region_id"]), "city": row["city"], "region": row["region"]}

	def is_region_initialized(self, region_id: int) -> bool:
		row = self._conn.execute(
			"SELECT initialized_at FROM region_state WHERE region_id = ?",
			(region_id,),
		).fetchone()
		return bool(row and row["initialized_at"])

	def mark_region_initialized(self, region_id: int, ts: int) -> None:
		with self._lock:
			self._conn.execute(
				"""
				INSERT INTO region_state(region_id, initialized_at, last_bootstrap_at, updated_at)
				VALUES (?, ?, ?, ?)
				ON CONFLICT(region_id) DO UPDATE SET
					initialized_at = COALESCE(region_state.initialized_at, excluded.initialized_at),
					last_bootstrap_at = excluded.last_bootstrap_at,
					updated_at = excluded.updated_at
				""",
				(region_id, ts, ts, ts),
			)

	def get_stock_record(self, region_id: int, article: str) -> dict[str, Any] | None:
		row = self._conn.execute(
			"""
			SELECT region_id, article, language_id, product_code, product_title, city_title,
				   price, price_old, count, stores_json, exact_match, message,
				   source, search_source, updated_at, last_success_at, last_attempt_at,
				   last_error, sync_token
			FROM stock_records
			WHERE region_id = ? AND article = ?
			""",
			(region_id, article),
		).fetchone()
		if row is None:
			return None
		return self._row_to_stock_record(row)

	def _row_to_stock_record(self, row: sqlite3.Row) -> dict[str, Any]:
		stores_raw = row["stores_json"] or "[]"
		try:
			stores = json.loads(stores_raw)
			if not isinstance(stores, list):
				stores = []
		except json.JSONDecodeError:
			stores = []

		return {
			"regionId": int(row["region_id"]),
			"article": str(row["article"]),
			"languageId": str(row["language_id"]),
			"productCode": str(row["product_code"] or "").strip(),
			"productTitle": str(row["product_title"] or "").strip(),
			"cityTitle": str(row["city_title"] or "").strip(),
			"price": row["price"],
			"priceOld": row["price_old"],
			"count": int(row["count"] or 0),
			"stores": stores,
			"exactMatch": bool(int(row["exact_match"] or 0)),
			"message": str(row["message"] or "").strip(),
			"source": str(row["source"] or ""),
			"searchSource": str(row["search_source"] or ""),
			"updatedAt": int(row["updated_at"] or 0),
			"lastSuccessAt": int(row["last_success_at"] or 0),
			"lastAttemptAt": int(row["last_attempt_at"] or 0),
			"lastError": str(row["last_error"] or "").strip(),
			"syncToken": int(row["sync_token"] or 0),
		}

	def upsert_stock_success(
		self,
		region_id: int,
		article: str,
		language_id: str,
		payload: dict[str, Any],
		ts: int,
	) -> None:
		stores = payload.get("stores") if isinstance(payload.get("stores"), list) else []
		price = to_number(payload.get("price"))
		price_old = to_number(payload.get("priceOld"))
		count_raw = payload.get("count")
		count = int(count_raw) if str(count_raw).isdigit() else len(stores)

		with self._lock:
			self._conn.execute("BEGIN")
			try:
				sync_token = self._next_sync_token_locked()
				self._conn.execute(
					"""
					INSERT INTO stock_records(
						region_id, article, language_id, product_code, product_title, city_title,
						price, price_old, count, stores_json, exact_match, message, source,
						search_source, updated_at, last_success_at, last_attempt_at, last_error,
						sync_token
					)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)
					ON CONFLICT(region_id, article) DO UPDATE SET
						language_id = excluded.language_id,
						product_code = excluded.product_code,
						product_title = excluded.product_title,
						city_title = excluded.city_title,
						price = excluded.price,
						price_old = excluded.price_old,
						count = excluded.count,
						stores_json = excluded.stores_json,
						exact_match = excluded.exact_match,
						message = excluded.message,
						source = excluded.source,
						search_source = excluded.search_source,
						updated_at = excluded.updated_at,
						last_success_at = excluded.last_success_at,
						last_attempt_at = excluded.last_attempt_at,
						last_error = '',
						sync_token = excluded.sync_token
					""",
					(
						region_id,
						article,
						language_id,
						str(payload.get("productCode", "")).strip(),
						str(payload.get("productTitle", "")).strip(),
						str(payload.get("cityTitle", "")).strip(),
						price,
						price_old,
						count,
						json.dumps(stores, ensure_ascii=False),
						1 if payload.get("exactMatch") else 0,
						str(payload.get("message", "")).strip(),
						str(payload.get("source", "")).strip(),
						str(payload.get("searchSource", "")).strip(),
						ts,
						ts,
						ts,
						sync_token,
					),
				)
				self._conn.execute(
					"DELETE FROM refresh_queue WHERE region_id = ? AND article = ?",
					(region_id, article),
				)
				self._conn.execute("COMMIT")
			except Exception:
				self._conn.execute("ROLLBACK")
				raise

	def mark_stock_error(self, region_id: int, article: str, language_id: str, error_text: str, ts: int) -> None:
		with self._lock:
			self._conn.execute(
				"""
				INSERT INTO stock_records(region_id, article, language_id, count, stores_json, last_attempt_at, last_error)
				VALUES (?, ?, ?, 0, '[]', ?, ?)
				ON CONFLICT(region_id, article) DO UPDATE SET
					last_attempt_at = excluded.last_attempt_at,
					last_error = excluded.last_error
				""",
				(region_id, article, language_id, ts, error_text[:500]),
			)

	def enqueue_retry(self, region_id: int, article: str, reason: str, next_retry_at: int, ts: int) -> None:
		with self._lock:
			self._conn.execute(
				"""
				INSERT INTO refresh_queue(region_id, article, next_retry_at, processing, reason, attempts, updated_at)
				VALUES (?, ?, ?, 0, ?, 1, ?)
				ON CONFLICT(region_id, article) DO UPDATE SET
					next_retry_at = excluded.next_retry_at,
					processing = 0,
					reason = excluded.reason,
					attempts = refresh_queue.attempts + 1,
					updated_at = excluded.updated_at
				""",
				(region_id, article, next_retry_at, reason[:200], ts),
			)

	def mark_queue_processing(self, region_id: int, article: str, processing: bool, ts: int) -> None:
		with self._lock:
			self._conn.execute(
				"""
				UPDATE refresh_queue
				SET processing = ?, updated_at = ?
				WHERE region_id = ? AND article = ?
				""",
				(1 if processing else 0, ts, region_id, article),
			)

	def list_region_stock(self, region_id: int, since_token: int | None = None) -> tuple[list[dict[str, Any]], int]:
		if since_token is None:
			rows = self._conn.execute(
				"SELECT * FROM stock_records WHERE region_id = ? ORDER BY article",
				(region_id,),
			).fetchall()
		else:
			rows = self._conn.execute(
				"SELECT * FROM stock_records WHERE region_id = ? AND sync_token > ? ORDER BY article",
				(region_id, since_token),
			).fetchall()

		max_token_row = self._conn.execute(
			"SELECT COALESCE(MAX(sync_token), 0) AS max_token FROM stock_records WHERE region_id = ?",
			(region_id,),
		).fetchone()
		max_token = int(max_token_row["max_token"] if max_token_row else 0)
		return [self._row_to_stock_record(row) for row in rows], max_token

	def cleanup_old_views(self, ts: int, window_seconds: int) -> None:
		threshold = ts - window_seconds
		with self._lock:
			self._conn.execute("DELETE FROM view_events WHERE viewed_at < ?", (threshold,))

	def cleanup_old_views_if_due(self, ts: int, window_seconds: int, min_interval_seconds: int) -> int:
		threshold = ts - window_seconds
		with self._lock:
			last_cleanup = self._get_meta_int("last_view_cleanup_at", 0)
			if last_cleanup > 0 and ts - last_cleanup < min_interval_seconds:
				return 0
			cursor = self._conn.execute("DELETE FROM view_events WHERE viewed_at < ?", (threshold,))
			deleted = int(cursor.rowcount if cursor.rowcount is not None and cursor.rowcount >= 0 else 0)
			self._set_meta("last_view_cleanup_at", str(ts))
			return deleted

	def add_view_event(self, region_id: int, article: str, user_hash: str, ts: int) -> None:
		with self._lock:
			self._conn.execute(
				"INSERT INTO view_events(region_id, article, user_hash, viewed_at) VALUES (?, ?, ?, ?)",
				(region_id, article, user_hash, ts),
			)

	def get_view_stats(self, region_id: int, article: str, ts: int, window_seconds: int) -> dict[str, int]:
		threshold = ts - window_seconds
		region_count = self._conn.execute(
			"""
			SELECT COUNT(DISTINCT user_hash) AS c
			FROM view_events
			WHERE region_id = ? AND article = ? AND viewed_at >= ?
			""",
			(region_id, article, threshold),
		).fetchone()
		kz_count = self._conn.execute(
			"""
			SELECT COUNT(DISTINCT user_hash) AS c
			FROM view_events
			WHERE article = ? AND viewed_at >= ?
			""",
			(article, threshold),
		).fetchone()
		return {
			"region7d": int(region_count["c"] if region_count else 0),
			"kz7d": int(kz_count["c"] if kz_count else 0),
		}

	def pick_next_background_item(self, ts: int) -> tuple[int, str] | None:
		queue_row = self._conn.execute(
			"""
			SELECT region_id, article
			FROM refresh_queue
			WHERE processing = 0 AND next_retry_at <= ?
			ORDER BY next_retry_at ASC
			LIMIT 1
			""",
			(ts,),
		).fetchone()
		if queue_row:
			return int(queue_row["region_id"]), str(queue_row["article"])

		row = self._conn.execute(
			"""
			SELECT sr.region_id, sr.article
			FROM stock_records sr
			JOIN region_state rs ON rs.region_id = sr.region_id
			WHERE rs.initialized_at IS NOT NULL
			ORDER BY COALESCE(sr.last_success_at, 0) ASC
			LIMIT 1
			"""
		).fetchone()
		if row is None:
			return None
		return int(row["region_id"]), str(row["article"])

	def count_background_scope(self) -> int:
		row = self._conn.execute(
			"""
			SELECT COUNT(*) AS c
			FROM stock_records sr
			JOIN region_state rs ON rs.region_id = sr.region_id
			WHERE rs.initialized_at IS NOT NULL
			"""
		).fetchone()
		return int(row["c"] if row else 0)

	def backup_to(self, backup_path: Path) -> None:
		backup_path.parent.mkdir(parents=True, exist_ok=True)
		source_conn = sqlite3.connect(self.db_path, check_same_thread=False)
		dest_conn = sqlite3.connect(backup_path, check_same_thread=False)
		try:
			source_conn.execute("PRAGMA busy_timeout=30000")
			dest_conn.execute("PRAGMA journal_mode=DELETE")
			source_conn.backup(dest_conn)
		finally:
			dest_conn.close()
			source_conn.close()

	def get_last_backup_date(self) -> str:
		row = self._conn.execute("SELECT value FROM meta WHERE key = 'last_backup_date'").fetchone()
		return str(row[0]) if row else ""

	def set_last_backup_date(self, value: str) -> None:
		with self._lock:
			self._set_meta("last_backup_date", value)

	def get_last_tracked_csv_refresh_at(self) -> int:
		return self._get_meta_int("last_tracked_csv_refresh_at", 0)

	def set_last_tracked_csv_refresh_at(self, value: int) -> None:
		with self._lock:
			self._set_meta("last_tracked_csv_refresh_at", str(max(0, int(value))))

	def get_pragma_snapshot(self) -> dict[str, Any]:
		journal_mode = self._conn.execute("PRAGMA journal_mode").fetchone()[0]
		synchronous = self._conn.execute("PRAGMA synchronous").fetchone()[0]
		wal_autocheckpoint = self._conn.execute("PRAGMA wal_autocheckpoint").fetchone()[0]
		return {
			"journal_mode": journal_mode,
			"synchronous": synchronous,
			"wal_autocheckpoint": wal_autocheckpoint,
		}


def extract_article(value: str) -> str:
	raw = str(value or "").strip()
	if not raw:
		return ""
	digits = "".join(ch for ch in raw if ch.isdigit())
	if len(digits) >= 5:
		return digits
	match = re.search(r"\b(\d{5,})\b", raw)
	return str(match.group(1)) if match else ""


def load_tracked_articles(config: ServerConfig) -> set[str]:
	text = ""
	if config.tracked_csv_url:
		try:
			req = Request(config.tracked_csv_url, method="GET", headers={"User-Agent": "Mozilla/5.0"})
			with urlopen(req, timeout=config.upstream_timeout_seconds) as response:
				text = response.read().decode("utf-8", errors="replace")
			LOGGER.info("csv source=remote articles_url=%s", config.tracked_csv_url)
		except Exception as exc:  # pylint: disable=broad-except
			LOGGER.error("csv_remote_failed error=%s", exc)

	if not text:
		path = Path(config.tracked_csv_path)
		if not path.exists():
			raise FileNotFoundError(f"Tracked CSV not found: {path}")
		text = path.read_text(encoding="utf-8", errors="replace")
		LOGGER.info("csv source=local path=%s", path)

	lines = [line for line in text.splitlines() if line.strip()]
	if not lines:
		return set()

	sniffer = csv.Sniffer()
	delimiter = ","
	try:
		dialect = sniffer.sniff("\n".join(lines[:5]))
		delimiter = dialect.delimiter
	except csv.Error:
		delimiter = ";" if ";" in lines[0] else ","

	reader = csv.reader(lines, delimiter=delimiter)
	rows = list(reader)
	if not rows:
		return set()

	index = max(0, config.tracked_csv_article_column - 1)
	body = rows[1:] if rows else []
	articles: set[str] = set()
	for row in body:
		if index >= len(row):
			continue
		article = extract_article(row[index])
		if article:
			articles.add(article)

	return articles


def load_regions(path: str) -> list[dict[str, Any]]:
	payload = json.loads(Path(path).read_text(encoding="utf-8"))
	rows = payload.get("regions") if isinstance(payload, dict) else payload
	if not isinstance(rows, list):
		raise ValueError("regions file must contain list or {regions:[...]}")

	normalized: list[dict[str, Any]] = []
	for item in rows:
		if not isinstance(item, dict):
			continue
		region_id = int(item.get("id", 0))
		city = str(item.get("city", "")).strip()
		region = str(item.get("region", "")).strip()
		if region_id > 0 and city and region:
			normalized.append({"id": region_id, "city": city, "region": region})
	return normalized


def normalize_google_sheet_csv_url(value: str) -> str:
	raw = str(value or "").strip()
	if not raw:
		return ""

	try:
		parsed = urlparse(raw)
	except Exception:
		return ""

	if parsed.scheme != "https" or parsed.netloc != "docs.google.com":
		return ""

	match = re.match(r"^/spreadsheets/d/([^/]+)/", parsed.path, re.I)
	if not match or not match.group(1):
		return ""

	sheet_id = match.group(1).strip()
	query = parse_qs(parsed.query)
	gid = (query.get("gid", [""])[0] or "").strip()
	if not gid:
		hash_match = re.search(r"gid=(\d+)", parsed.fragment or "", re.I)
		gid = hash_match.group(1).strip() if hash_match else ""

	gid_part = f"&gid={gid}" if gid.isdigit() else ""
	return f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv{gid_part}"


def is_authorized_sheet_url(sheet_url: str) -> tuple[bool, str, str]:
	normalized_input = normalize_google_sheet_csv_url(sheet_url)
	normalized_allowed = normalize_google_sheet_csv_url(CONFIG.tracked_csv_url)
	if not normalized_allowed:
		return False, normalized_input, "Сервер не настроен: разрешённая таблица не задана в конфиге."
	if not normalized_input:
		return False, normalized_input, "Некорректная ссылка Google Sheets."
	if normalized_input != normalized_allowed:
		return False, normalized_input, "Доступ запрещён: ссылка таблицы не совпадает с разрешённой."
	return True, normalized_input, "ok"


def get_client_ip(handler: BaseHTTPRequestHandler) -> str:
	forwarded = handler.headers.get("X-Forwarded-For", "")
	if forwarded:
		first_ip = forwarded.split(",")[0].strip()
		if first_ip:
			return first_ip
	return handler.client_address[0]


_rate_lock = threading.Lock()
_rate_buckets: dict[str, deque] = {}


def is_rate_limited(client_ip: str) -> bool:
	now = time.monotonic()
	with _rate_lock:
		bucket = _rate_buckets.setdefault(client_ip, deque())
		while bucket and now - bucket[0] > CONFIG.rate_limit_window:
			bucket.popleft()
		if len(bucket) >= CONFIG.rate_limit_max:
			return True
		bucket.append(now)
		return False


def capture(text: str, pattern: str) -> str:
	match = re.search(pattern, text, re.I)
	return match.group(1).strip() if match else ""


def decode_text(text: str) -> str:
	if not text:
		return ""
	cleaned = re.sub(r"<[^>]*>", "", text)
	return unescape(cleaned).strip()


def to_number(value: Any) -> float | None:
	try:
		if value is None:
			return None
		return float(value)
	except (TypeError, ValueError):
		return None


def read_http_error_body(error: HTTPError) -> str:
	try:
		return error.read().decode("utf-8", errors="replace")
	except Exception:
		return ""


def pick_exact_product(search_json: dict[str, Any], article: str) -> dict[str, Any] | None:
	products = search_json.get("products") if isinstance(search_json, dict) else None
	if not isinstance(products, list) or not products:
		return None
	target = str(article).strip()
	for item in products:
		if not isinstance(item, dict):
			continue
		if str(item.get("code", "")).strip() == target:
			return item
	return None


def extract_product_path_from_product(product: dict[str, Any]) -> str | None:
	value = product.get("url") if isinstance(product, dict) else None
	if isinstance(value, str) and value.startswith("/"):
		return value
	return None


def parse_stores(html: str) -> dict[str, Any]:
	stores: list[dict[str, Any]] = []
	item_re = re.compile(r'<div class="product__in-stock-item">([\s\S]*?)</a>\s*</div>', re.I)
	for item_match in item_re.finditer(html):
		block = item_match.group(1)
		storage_id = capture(block, r'data-storage-id="(\d+)"')
		address = decode_text(capture(block, r'cart__delivery-type-title-text">([\s\S]*?)</span>'))
		availability = decode_text(capture(block, r'<span class="rest_[^"]*">([\s\S]*?)</span>'))
		if address:
			stores.append(
				{
					"storageId": storage_id,
					"address": address,
					"availability": availability,
				}
			)

	city_title = decode_text(capture(html, r'<h2 class="product__page-block-header">([\s\S]*?)</h2>'))
	return {"cityTitle": city_title, "stores": stores}


def fetch_sulpak_stock(city_id: str, article: str, language_id: str) -> dict[str, Any]:
	search_url = (
		"https://sulpak-api.evinent.site/api/search/autocomplete/"
		+ quote(city_id)
		+ "/"
		+ quote(language_id)
		+ "/"
		+ quote(article)
		+ "/true/"
	)

	search_req = Request(
		search_url,
		method="GET",
		headers={
			"Accept": "application/json,text/plain,*/*",
			"User-Agent": "Mozilla/5.0",
		},
	)

	LOGGER.info("api_request type=autocomplete cityId=%s article=%s", city_id, article)
	try:
		with urlopen(search_req, timeout=CONFIG.upstream_timeout_seconds) as response:
			search_raw = response.read().decode("utf-8", errors="replace")
			search_json = json.loads(search_raw)
	except HTTPError as error:
		body = read_http_error_body(error)
		raise UpstreamError("autocomplete_failed", int(error.code), body) from error
	except (URLError, TimeoutError) as error:
		raise UpstreamError("autocomplete_failed", 502, str(error)) from error

	exact_product = pick_exact_product(search_json, article)
	if exact_product is None:
		return {
			"source": "https://www.sulpak.kz/Goods/LoadRestStorages",
			"searchSource": search_url,
			"method": "POST",
			"cityId": city_id,
			"languageId": language_id,
			"article": article,
			"cityTitle": "",
			"count": 0,
			"stores": [],
			"price": None,
			"priceOld": None,
			"exactMatch": False,
			"message": "Точный товар по артикулу не найден",
		}

	price = to_number(exact_product.get("price"))
	price_old = to_number(exact_product.get("priceOld"))
	product_path = extract_product_path_from_product(exact_product)
	referer = f"https://www.sulpak.kz{product_path}" if product_path else "https://www.sulpak.kz/"

	if exact_product.get("isAvailable") is False:
		return {
			"source": "https://www.sulpak.kz/Goods/LoadRestStorages",
			"searchSource": search_url,
			"method": "POST",
			"cityId": city_id,
			"languageId": language_id,
			"article": article,
			"productCode": str(exact_product.get("code", "")).strip(),
			"productTitle": str(exact_product.get("title", "")).strip(),
			"price": price,
			"priceOld": price_old,
			"cityTitle": "",
			"count": 0,
			"stores": [],
			"exactMatch": True,
			"message": "Товар недоступен (isAvailable=false)",
		}

	payload = urlencode({"code": article}).encode("utf-8")
	stock_req = Request(
		"https://www.sulpak.kz/Goods/LoadRestStorages",
		data=payload,
		method="POST",
		headers={
			"Accept": "text/html, */*; q=0.01",
			"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
			"X-Requested-With": "XMLHttpRequest",
			"Cookie": f"city_id={city_id}; language_id={language_id}",
			"Referer": referer,
			"Origin": "https://www.sulpak.kz",
			"User-Agent": "Mozilla/5.0",
		},
	)

	LOGGER.info("api_request type=stock cityId=%s article=%s", city_id, article)
	try:
		with urlopen(stock_req, timeout=CONFIG.upstream_timeout_seconds) as response:
			html = response.read().decode("utf-8", errors="replace")
	except HTTPError as error:
		if error.code == 500:
			return {
				"source": "https://www.sulpak.kz/Goods/LoadRestStorages",
				"searchSource": search_url,
				"method": "POST",
				"cityId": city_id,
				"languageId": language_id,
				"article": article,
				"productCode": str(exact_product.get("code", "")).strip(),
				"productTitle": str(exact_product.get("title", "")).strip(),
				"price": price,
				"priceOld": price_old,
				"cityTitle": "",
				"count": 0,
				"stores": [],
				"exactMatch": True,
				"message": "Sulpak вернул 500, остатки недоступны",
			}
		body = read_http_error_body(error)
		raise UpstreamError("stock_failed", int(error.code), body) from error
	except (URLError, TimeoutError) as error:
		raise UpstreamError("stock_failed", 502, str(error)) from error

	parsed = parse_stores(html)
	return {
		"source": "https://www.sulpak.kz/Goods/LoadRestStorages",
		"searchSource": search_url,
		"method": "POST",
		"cityId": city_id,
		"languageId": language_id,
		"article": article,
		"productCode": str(exact_product.get("code", "")).strip(),
		"productTitle": str(exact_product.get("title", "")).strip(),
		"price": price,
		"priceOld": price_old,
		"cityTitle": parsed["cityTitle"],
		"count": len(parsed["stores"]),
		"stores": parsed["stores"],
		"exactMatch": True,
	}


class StockService:
	def __init__(self, config: ServerConfig, store: SQLiteStore) -> None:
		self.config = config
		self.store = store
		self.region_flights = SingleFlight()
		self.item_flights = SingleFlight()

	@staticmethod
	def _now() -> int:
		return int(time.time())

	def _is_fresh(self, record: dict[str, Any], now_ts: int) -> bool:
		last_success = int(record.get("lastSuccessAt") or 0)
		return last_success > 0 and now_ts - last_success < self.config.stock_ttl_seconds

	def ensure_region_bootstrapped(self, region_id: int, language_id: str) -> None:
		if self.store.is_region_initialized(region_id):
			return

		def bootstrap() -> None:
			started = time.time()
			articles = self.store.get_tracked_articles()
			LOGGER.info("bootstrap_start regionId=%s articles=%s", region_id, len(articles))
			success = 0
			failed = 0
			for article in articles:
				refreshed = self.refresh_item(region_id, article, language_id, reason="bootstrap")
				if refreshed is None:
					failed += 1
				else:
					success += 1

			self.store.mark_region_initialized(region_id, self._now())
			elapsed = time.time() - started
			LOGGER.info(
				"bootstrap_done regionId=%s success=%s failed=%s elapsedSec=%.2f",
				region_id,
				success,
				failed,
				elapsed,
			)

		self.region_flights.run(f"region:{region_id}", bootstrap)

	def refresh_item(self, region_id: int, article: str, language_id: str, reason: str) -> dict[str, Any] | None:
		key = f"item:{region_id}:{article}"

		def do_refresh() -> dict[str, Any] | None:
			ts = self._now()
			self.store.mark_queue_processing(region_id, article, True, ts)
			try:
				payload = fetch_sulpak_stock(str(region_id), article, language_id)
				self.store.upsert_stock_success(region_id, article, language_id, payload, ts)
				LOGGER.info("api_success regionId=%s article=%s reason=%s", region_id, article, reason)
			except UpstreamError as error:
				LOGGER.error(
					"api_error regionId=%s article=%s reason=%s code=%s upstreamStatus=%s",
					region_id,
					article,
					reason,
					error.code,
					error.status,
				)
				self.store.mark_stock_error(region_id, article, language_id, f"{error.code}:{error.status}", ts)
				self.store.enqueue_retry(
					region_id,
					article,
					f"{reason}:{error.code}",
					ts + self.config.retry_delay_seconds,
					ts,
				)
			except Exception as error:  # pylint: disable=broad-except
				LOGGER.error("api_error regionId=%s article=%s reason=%s error=%s", region_id, article, reason, error)
				self.store.mark_stock_error(region_id, article, language_id, str(error), ts)
				self.store.enqueue_retry(
					region_id,
					article,
					f"{reason}:internal",
					ts + self.config.retry_delay_seconds,
					ts,
				)
			finally:
				self.store.mark_queue_processing(region_id, article, False, self._now())

			return self.store.get_stock_record(region_id, article)

		record, _ = self.item_flights.run(key, do_refresh)
		return record

	def get_region_snapshot(
		self,
		region_id: int,
		language_id: str,
		since_token: int | None,
	) -> tuple[list[dict[str, Any]], int]:
		self.ensure_region_bootstrapped(region_id, language_id)
		return self.store.list_region_stock(region_id, since_token)

	def get_item(
		self,
		region_id: int,
		article: str,
		language_id: str,
		user_id: str | None,
	) -> dict[str, Any]:
		self.ensure_region_bootstrapped(region_id, language_id)
		now_ts = self._now()

		record = self.store.get_stock_record(region_id, article)
		if record is None or not self._is_fresh(record, now_ts):
			record = self.refresh_item(region_id, article, language_id, reason="user_request")

		record = record or self.store.get_stock_record(region_id, article)
		if record is None:
			return {
				"cityId": str(region_id),
				"article": article,
				"price": None,
				"priceOld": None,
				"count": 0,
				"stores": [],
				"cityTitle": "",
				"exactMatch": False,
				"message": "Данные пока отсутствуют",
				"meta": {
					"fromSQLite": True,
					"fresh": False,
					"ttlSeconds": self.config.stock_ttl_seconds,
					"ageSeconds": None,
				},
			}

		age = max(0, now_ts - int(record.get("lastSuccessAt") or 0))

		if user_id:
			self._register_view(region_id, article, user_id)

		stats = self.store.get_view_stats(region_id, article, now_ts, window_seconds=7 * 24 * 60 * 60)

		payload = {
			"cityId": str(region_id),
			"article": article,
			"languageId": language_id,
			"productCode": record.get("productCode"),
			"productTitle": record.get("productTitle"),
			"cityTitle": record.get("cityTitle") or "",
			"price": record.get("price"),
			"priceOld": record.get("priceOld"),
			"count": record.get("count") or 0,
			"stores": record.get("stores") or [],
			"exactMatch": bool(record.get("exactMatch")),
			"message": record.get("message") or "",
			"updatedAt": int(record.get("updatedAt") or 0),
			"meta": {
				"fromSQLite": True,
				"fresh": age < self.config.stock_ttl_seconds,
				"ttlSeconds": self.config.stock_ttl_seconds,
				"ageSeconds": age,
				"viewStats": {
					"region7d": stats["region7d"],
					"kz7d": stats["kz7d"],
				},
			},
		}
		return payload

	def _register_view(self, region_id: int, article: str, user_id: str) -> None:
		now_ts = self._now()
		user_hash = hashlib.sha256(user_id.encode("utf-8")).hexdigest()
		deleted = self.store.cleanup_old_views_if_due(
			now_ts,
			self.config.view_retention_seconds,
			self.config.view_cleanup_interval_seconds,
		)
		if deleted:
			LOGGER.info("view_cleanup deleted=%s retentionSec=%s", deleted, self.config.view_retention_seconds)
		self.store.add_view_event(region_id, article, user_hash, now_ts)


class MaintenanceWorker:
	def __init__(self, config: ServerConfig, store: SQLiteStore) -> None:
		self.config = config
		self.store = store
		self._stop_event = threading.Event()
		self._thread = threading.Thread(target=self._run, name="maintenance-worker", daemon=True)

	def start(self) -> None:
		self._thread.start()

	def stop(self) -> None:
		self._stop_event.set()
		self._thread.join(timeout=5)

	def _run(self) -> None:
		while not self._stop_event.is_set():
			now_ts = int(time.time())
			now = datetime.now()

			deleted = self.store.cleanup_old_views_if_due(
				now_ts,
				self.config.view_retention_seconds,
				self.config.view_cleanup_interval_seconds,
			)
			if deleted:
				LOGGER.info("view_cleanup deleted=%s retentionSec=%s source=maintenance", deleted, self.config.view_retention_seconds)

			self._maybe_refresh_tracked_articles(now_ts)
			self._maybe_backup(now)
			self._stop_event.wait(self.config.maintenance_poll_seconds)

	def _maybe_refresh_tracked_articles(self, now_ts: int) -> None:
		last_refresh = self.store.get_last_tracked_csv_refresh_at()
		if last_refresh > 0 and now_ts - last_refresh < self.config.tracked_csv_refresh_seconds:
			return

		try:
			tracked = load_tracked_articles(self.config)
			total = len(tracked)
			if not tracked:
				LOGGER.warning("tracked_csv_refresh_skipped reason=empty_list")
				self.store.set_last_tracked_csv_refresh_at(now_ts)
				return

			current = set(self.store.get_tracked_articles())
			new_articles = tracked - current
			removed_articles = current - tracked
			inserted, deleted = self.store.sync_tracked_articles(tracked)
			self.store.set_last_tracked_csv_refresh_at(now_ts)
			LOGGER.info(
				"tracked_csv_refreshed total=%s current=%s new=%s removed=%s inserted=%s deleted=%s refreshIntervalSec=%s",
				total,
				len(current),
				len(new_articles),
				len(removed_articles),
				inserted,
				deleted,
				self.config.tracked_csv_refresh_seconds,
			)
		except Exception as error:  # pylint: disable=broad-except
			LOGGER.error("tracked_csv_refresh_failed error=%s", error)

	def _maybe_backup(self, now: datetime) -> None:
		today = now.strftime("%Y-%m-%d")
		last_backup_date = self.store.get_last_backup_date()
		if last_backup_date == today or now.hour < self.config.backup_hour:
			return

		backup_dir = Path(self.config.backup_dir).resolve()
		filename = f"{self.store.db_path.stem}-{now.strftime('%Y%m%d-%H%M%S')}.sqlite3"
		backup_path = backup_dir / filename
		started = time.time()
		self.store.backup_to(backup_path)
		self.store.set_last_backup_date(today)
		deleted = self._cleanup_old_backups(backup_dir, now_ts=int(time.time()))
		LOGGER.info(
			"backup_done path=%s retentionDays=%s deletedOld=%s durationSec=%.2f",
			backup_path,
			self.config.backup_retention_days,
			deleted,
			time.time() - started,
		)

	def _cleanup_old_backups(self, backup_dir: Path, now_ts: int) -> int:
		deleted = 0
		threshold = now_ts - (self.config.backup_retention_days * 24 * 60 * 60)
		for path in backup_dir.glob("*.sqlite3"):
			try:
				if int(path.stat().st_mtime) < threshold:
					path.unlink()
					deleted += 1
			except OSError as error:
				LOGGER.error("backup_cleanup_failed path=%s error=%s", path, error)
		return deleted


class BackgroundRefresher:
	def __init__(self, config: ServerConfig, service: StockService) -> None:
		self.config = config
		self.service = service
		self._stop_event = threading.Event()
		self._thread = threading.Thread(target=self._run, name="background-refresher", daemon=True)
		self._cycle_started_at: float | None = None
		self._cycle_counter = 0

	def start(self) -> None:
		self._thread.start()

	def stop(self) -> None:
		self._stop_event.set()
		self._thread.join(timeout=5)

	def _within_working_hours(self, now: datetime) -> bool:
		start = self.config.background_start_hour
		end = self.config.background_end_hour
		if start == end:
			return True
		if start < end:
			return start <= now.hour < end
		return now.hour >= start or now.hour < end

	def _dynamic_interval(self, scope_count: int) -> float:
		if scope_count <= 0:
			return max(self.config.background_min_interval_seconds, 5.0)
		interval = self.config.background_cycle_seconds / max(scope_count, 1)
		return max(self.config.background_min_interval_seconds, float(interval))

	def _run(self) -> None:
		while not self._stop_event.is_set():
			now = datetime.now()
			if not self._within_working_hours(now):
				self._stop_event.wait(self.config.background_off_hours_sleep_seconds)
				continue

			scope_count = self.service.store.count_background_scope()
			interval = self._dynamic_interval(scope_count)
			next_item = self.service.store.pick_next_background_item(int(time.time()))

			if next_item is None:
				self._stop_event.wait(min(interval, 15.0))
				continue

			region_id, article = next_item
			if self._cycle_started_at is None:
				self._cycle_started_at = time.time()
				self._cycle_counter = 0

			started = time.time()
			self.service.refresh_item(
				region_id=region_id,
				article=article,
				language_id=self.config.default_language_id,
				reason="background",
			)
			self._cycle_counter += 1

			if scope_count > 0 and self._cycle_counter >= scope_count:
				elapsed = time.time() - (self._cycle_started_at or started)
				LOGGER.info(
					"background_cycle_done items=%s scope=%s elapsedSec=%.2f targetSec=%s",
					self._cycle_counter,
					scope_count,
					elapsed,
					self.config.background_cycle_seconds,
				)
				self._cycle_started_at = time.time()
				self._cycle_counter = 0

			elapsed_request = time.time() - started
			sleep_for = max(0.0, interval - elapsed_request)
			self._stop_event.wait(sleep_for)


STORE = SQLiteStore(CONFIG.db_path)
SERVICE = StockService(CONFIG, STORE)
BACKGROUND = BackgroundRefresher(CONFIG, SERVICE)
MAINTENANCE = MaintenanceWorker(CONFIG, STORE)


def bootstrap_reference_data() -> None:
	tracked = load_tracked_articles(CONFIG)
	if not tracked:
		raise RuntimeError("Tracked article list is empty")
	inserted_articles, deleted_articles = STORE.sync_tracked_articles(tracked)
	LOGGER.info(
		"tracked_articles_loaded total=%s inserted=%s deleted=%s",
		len(tracked),
		inserted_articles,
		deleted_articles,
	)

	regions = load_regions(CONFIG.regions_file_path)
	if not regions:
		raise RuntimeError("Region list is empty")
	inserted_regions, updated_regions, deleted_regions = STORE.sync_regions(regions)
	LOGGER.info(
		"regions_loaded total=%s inserted=%s updated=%s deleted=%s",
		len(regions),
		inserted_regions,
		updated_regions,
		deleted_regions,
	)


class ProxyHandler(BaseHTTPRequestHandler):
	server_version = "SulpakProxy/2.0"

	def do_OPTIONS(self) -> None:
		self.send_response(204)
		self._set_cors_headers()
		if self.headers.get("Access-Control-Request-Private-Network") == "true":
			self.send_header("Access-Control-Allow-Private-Network", "true")
		self.end_headers()

	def do_GET(self) -> None:
		started = time.time()
		parsed = urlparse(self.path)
		client_ip = get_client_ip(self)

		if parsed.path == "/health":
			self._json(
				200,
				{
					"ok": True,
					"dbPath": str(STORE.db_path),
					"trackedArticles": len(STORE.get_tracked_articles()),
					"sqlite": STORE.get_pragma_snapshot(),
				},
			)
			return

		if parsed.path == "/":
			self._json(
				200,
				{
					"name": "sulpak-stock-proxy",
					"ok": True,
					"endpoints": {
						"regionStock": "/region-stock?cityId=1&languageId=3",
						"stock": "/stock?cityId=1&article=628340&languageId=3",
						"health": "/health",
					},
				},
			)
			return

		if is_rate_limited(client_ip):
			self._json(429, {"error": "rate_limited", "message": "Слишком много запросов"})
			return

		try:
			if parsed.path == "/auth/validate":
				self._handle_auth_validate(parsed, started, client_ip)
				return

			if parsed.path == "/region-stock":
				self._handle_region_stock(parsed, started, client_ip)
				return

			if parsed.path == "/stock":
				self._handle_stock(parsed, started, client_ip)
				return

			self._json(404, {"error": "not_found"})
		except Exception as error:  # pylint: disable=broad-except
			LOGGER.exception("request_failed path=%s error=%s", parsed.path, error)
			self._json(500, {"error": "internal_error", "message": str(error)})

	def _handle_auth_validate(self, parsed, started: float, client_ip: str) -> None:
		params = parse_qs(parsed.query)
		sheet_url = (params.get("sheetUrl", [""])[0] or "").strip()
		authorized, normalized_sheet_url, message = is_authorized_sheet_url(sheet_url)
		duration_ms = int((time.time() - started) * 1000)
		LOGGER.info(
			"auth_validate ip=%s authorized=%s durationMs=%s",
			client_ip,
			authorized,
			duration_ms,
		)
		self._json(
			200 if authorized else 403,
			{
				"authorized": authorized,
				"normalizedSheetUrl": normalized_sheet_url,
				"message": message,
			},
		)

	def _handle_region_stock(self, parsed, started: float, client_ip: str) -> None:
		params = parse_qs(parsed.query)
		city_id = (params.get("cityId", params.get("regionId", [""]))[0] or "").strip()
		language_id = (params.get("languageId", [CONFIG.default_language_id])[0] or CONFIG.default_language_id).strip()
		since_raw = (params.get("since", [""])[0] or "").strip()

		if not city_id.isdigit() or not language_id.isdigit():
			self._json(400, {"error": "invalid_params", "message": "cityId/languageId must be numeric"})
			return

		region_id = int(city_id)
		region = STORE.get_region(region_id)
		if region is None:
			self._json(404, {"error": "unknown_region", "message": "Регион не найден в конфигурации"})
			return

		since_token = int(since_raw) if since_raw.isdigit() else None
		rows, sync_token = SERVICE.get_region_snapshot(region_id, language_id, since_token)

		payload_items = [
			{
				"article": row["article"],
				"price": row["price"],
				"priceOld": row["priceOld"],
				"count": row["count"],
				"stores": row["stores"],
				"cityTitle": row["cityTitle"],
				"updatedAt": row["updatedAt"],
				"exactMatch": row["exactMatch"],
				"message": row["message"],
				"syncToken": row["syncToken"],
			}
			for row in rows
		]

		duration_ms = int((time.time() - started) * 1000)
		LOGGER.info(
			"sqlite_response path=/region-stock ip=%s cityId=%s since=%s items=%s syncToken=%s durationMs=%s",
			client_ip,
			city_id,
			since_token,
			len(payload_items),
			sync_token,
			duration_ms,
		)

		self._json(
			200,
			{
				"cityId": city_id,
				"city": region["city"],
				"region": region["region"],
				"languageId": language_id,
				"syncToken": sync_token,
				"items": payload_items,
				"meta": {
					"fromSQLite": True,
					"delta": since_token is not None,
					"durationMs": duration_ms,
				},
			},
		)

	def _handle_stock(self, parsed, started: float, client_ip: str) -> None:
		params = parse_qs(parsed.query)
		city_id = (params.get("cityId", params.get("regionId", [""]))[0] or "").strip()
		article = (params.get("article", [""])[0] or "").strip()
		language_id = (params.get("languageId", [CONFIG.default_language_id])[0] or CONFIG.default_language_id).strip()
		user_id = (params.get("userId", [""])[0] or "").strip()

		if not city_id.isdigit() or not article.isdigit() or not language_id.isdigit():
			self._json(
				400,
				{
					"error": "invalid_params",
					"message": "cityId, article, languageId must be numeric strings",
				},
			)
			return

		region_id = int(city_id)
		region = STORE.get_region(region_id)
		if region is None:
			self._json(404, {"error": "unknown_region", "message": "Регион не найден в конфигурации"})
			return

		if not STORE.has_tracked_article(article):
			self._json(404, {"error": "not_tracked", "message": "Артикул не входит в список отслеживаемых"})
			return

		payload = SERVICE.get_item(
			region_id=region_id,
			article=article,
			language_id=language_id,
			user_id=user_id or None,
		)

		payload.setdefault("cityTitle", region["city"])

		duration_ms = int((time.time() - started) * 1000)
		LOGGER.info(
			"sqlite_response path=/stock ip=%s cityId=%s article=%s durationMs=%s fresh=%s",
			client_ip,
			city_id,
			article,
			duration_ms,
			bool(payload.get("meta", {}).get("fresh")),
		)
		self._json(200, payload)

	def log_message(self, fmt: str, *args) -> None:
		return

	def _set_cors_headers(self) -> None:
		origin = self.headers.get("Origin", "")
		allowed_origin = origin if origin in CONFIG.allowed_origins else CONFIG.allowed_origins[0]
		self.send_header("Access-Control-Allow-Origin", allowed_origin)
		self.send_header("Vary", "Origin")
		self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
		self.send_header("Access-Control-Allow-Headers", "Content-Type")

	def _json(self, status: int, payload: dict[str, Any]) -> None:
		body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
		self.send_response(status)
		self._set_cors_headers()
		self.send_header("Content-Type", "application/json; charset=utf-8")
		self.send_header("Content-Length", str(len(body)))
		self.end_headers()
		self.wfile.write(body)


class ProxyServer(ThreadingHTTPServer):
	request_queue_size = 128
	daemon_threads = True


def main() -> None:
	bootstrap_reference_data()
	BACKGROUND.start()
	MAINTENANCE.start()
	server = ProxyServer((CONFIG.host, CONFIG.port), ProxyHandler)
	LOGGER.info("server_start host=%s port=%s db=%s", CONFIG.host, CONFIG.port, STORE.db_path)
	try:
		server.serve_forever()
	finally:
		BACKGROUND.stop()
		MAINTENANCE.stop()


if __name__ == "__main__":
	main()
