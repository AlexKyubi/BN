import { constants } from "./state.js";
import { escapeHtml, escapeRegExp, normalizeArticleSearchInput, parsePercent, parseRating } from "./utils.js";

export function buildItem(row, indices) {
    const article = resolveArticleFromRow(row, indices);

    const c = String(row[constants.ARTICLE_COLUMN_INDEX] || "").trim();
    const d = String(row[3] || "").trim();
    let title = [c, d].filter(Boolean).join(" ").trim();
    if (!title && typeof indices.title === "number" && indices.title >= 0) {
        title = String(row[indices.title] || "").trim();
    }

    if (article) {
        try {
            const re = new RegExp("(?:#\\s*)?" + escapeRegExp(article), "gi");
            title = title.replace(re, "").replace(/\s{2,}/g, " ").trim();
        } catch (error) {
            // ignore regexp errors
        }
    }

    let category = "";
    if (typeof indices.category === "number" && indices.category >= 0) {
        category = String(row[indices.category] || "").trim();
    }
    if (!category && row.length > 1) {
        category = String(row[1] || "").trim();
    }
    category = category || "Без категории";

    const rawRating = row[indices.rating] || "";
    const stars = parseRating(rawRating);
    const percent = parsePercent(rawRating);

    if (!article) {
        return null;
    }

    let finalPercent = percent;
    if (finalPercent == null && indices.rating === constants.DEFAULT_MONTH_COLUMN_INDEX) {
        finalPercent = 0;
    }
    if (finalPercent == null && row.length > 4) {
        const tryE = parsePercent(row[4]);
        if (tryE != null) {
            finalPercent = tryE;
        }
    }

    return {
        article,
        title: title || article,
        category,
        stars,
        percent: finalPercent,
        image: `${constants.IMAGE_BASE_PATH}/${article}.webp`,
    };
}

export function resolveArticleFromRow(row) {
    return extractArticleFromText(row?.[constants.ARTICLE_COLUMN_INDEX]);
}

export function extractArticleFromText(value) {
    const raw = String(value || "").trim();
    if (!raw) {
        return "";
    }

    const normalizedOnlyDigits = normalizeArticleSearchInput(raw);
    if (normalizedOnlyDigits.length >= 5) {
        return normalizedOnlyDigits;
    }

    const match = raw.match(/\b(\d{5,})\b/);
    return match ? String(match[1]).trim() : "";
}

export function buildSulpakCharacteristicsUrl(article) {
    const normalizedArticle = String(article || "").trim().replace(/^#+/, "");
    if (!normalizedArticle) {
        return "";
    }

    return `https://www.sulpak.kz/g/${encodeURIComponent(normalizedArticle)}#characteristicsTab`;
}

export function createCardMarkup(item, context) {
    const { dom, getStockRecordByArticle, formatMoneyKzt, openViewerWithImage, showStockInfoModal, buildSulpakCharacteristicsUrl, saveQuickReturnState } = context;
    const clone = dom.template.content.cloneNode(true);
    const card = clone.querySelector(".card");
    const image = clone.querySelector(".photo");
    const titleEl = clone.querySelector(".card-title");
    const priceEl = clone.querySelector(".card-price");
    const articleEl = clone.querySelector(".card-article");
    const stockInfoEl = clone.querySelector(".card-stock-info");
    const modelEl = clone.querySelector(".card-model");
    const starsEl = clone.querySelector(".card-stars");
    const stockRecord = getStockRecordByArticle(item.article);

    let display = 0;
    if (typeof item.percent === "number") {
        display = Math.max(0, Math.min(5, Math.round(item.percent)));
    } else {
        const raw = Number(item.stars) || 0;
        if (raw > 5) {
            display = Math.round(Math.min(100, raw) / 20);
        } else if (raw > 0 && raw <= 1) {
            display = Math.round(raw * 5);
        } else {
            display = Math.round(raw);
        }
        display = Math.max(0, Math.min(5, display));
    }

    card.classList.add(`stars${display}`);
    const filledStars = "★".repeat(display);
    const hollowStars = "☆".repeat(5 - display);
    const starsHtml = `<span class="stars-text">${filledStars}</span><span class="stars-hollow">${hollowStars}</span>`;
    starsEl.innerHTML = starsHtml;

    const placeholderSvg = encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800">' +
        '<rect width="100%" height="100%" fill="#0f1724"/>' +
        '<g fill="#cbd5e1" opacity="0.9">' +
        '<rect x="80" y="180" width="640" height="420" rx="20"/>' +
        '<circle cx="200" cy="400" r="70"/>' +
        '</g>' +
        '<text x="50%" y="90%" fill="#8b9bb0" font-size="36" font-family="Inter, Arial, sans-serif" text-anchor="middle">Нет фото</text>' +
        '</svg>'
    );
    const placeholder = `data:image/svg+xml;utf8,${placeholderSvg}`;

    image.src = item.image || placeholder;
    image.alt = item.title;

    image.addEventListener("error", () => {
        if (image.src !== placeholder) {
            image.src = placeholder;
        }
        image.classList.add("no-photo");
    });
    image.addEventListener("load", () => {
        image.classList.remove("no-photo");
    });

    titleEl.textContent = item.title;
    priceEl.textContent = `Цена: ${formatMoneyKzt(stockRecord?.price)}`;
    articleEl.textContent = `Артикул: #${item.article}`;

    priceEl.title = stockRecord
        ? `Остаток: ${Number.isFinite(Number(stockRecord.count)) ? Number(stockRecord.count) : 0}`
        : "Цена и остатки будут доступны после загрузки в личном кабинете";

    if (stockInfoEl) {
        const count = Number.isFinite(Number(stockRecord?.count)) ? Number(stockRecord.count) : 0;
        stockInfoEl.textContent = count > 0 ? String(count) : "i";
        stockInfoEl.title = stockRecord
            ? `Показать остатки (${count})`
            : "Нет данных по остаткам. Обновите в личном кабинете";
    }

    modelEl.textContent = item.category;

    articleEl.addEventListener("click", (event) => {
        event.stopPropagation();
    });

    articleEl.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const url = buildSulpakCharacteristicsUrl(item.article);
        if (!url) {
            return;
        }

        saveQuickReturnState();
        window.location.assign(url);
    });

    if (stockInfoEl) {
        stockInfoEl.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            showStockInfoModal(item);
        });
    }

    card.addEventListener("click", () => {
        if (item.image) {
            openViewerWithImage(item.image, item.title);
        }
    });

    return clone;
}
