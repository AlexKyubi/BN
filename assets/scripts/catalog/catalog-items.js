import { ARTICLE_COLUMN_INDEX, DEFAULT_MONTH_COLUMN_INDEX } from "../config.js";
import { escapeRegExp, extractArticleFromText, parsePercent, parseRating } from "../utils.js";

/**
 * Построение карточки товара из строки CSV и вспомогательные функции по артикулу/ссылкам.
 */

/** Извлекает артикул из строки CSV по колонке артикула. */
export function resolveArticleFromRow(row) {
    return extractArticleFromText(row?.[ARTICLE_COLUMN_INDEX]);
}

/** Превращает строку CSV в объект товара для каталога (или null, если артикул не найден). */
export function buildItem(row, indices) {
    const article = resolveArticleFromRow(row);

    const c = String(row[ARTICLE_COLUMN_INDEX] || "").trim();
    const d = String(row[3] || "").trim();
    let title = [c, d].filter(Boolean).join(" ").trim();
    if (!title && typeof indices.title === "number" && indices.title >= 0) {
        title = String(row[indices.title] || "").trim();
    }

    if (article) {
        try {
            // Убираем артикул из названия, чтобы не дублировать его в заголовке карточки.
            const re = new RegExp("(?:#\\s*)?" + escapeRegExp(article), "gi");
            title = title.replace(re, "").replace(/\s{2,}/g, " ").trim();
        } catch (error) {
            // regexp не собрался — оставляем название как есть
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
    if (finalPercent == null && indices.rating === DEFAULT_MONTH_COLUMN_INDEX) {
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
        // Фото товара больше не хранится локально — подгружается из карточки остатков (photoUrl).
        image: "",
    };
}

/** Строит ссылку на вкладку характеристик товара на сайте Sulpak. */
export function buildSulpakCharacteristicsUrl(article) {
    const normalizedArticle = String(article || "").trim().replace(/^#+/, "");
    if (!normalizedArticle) {
        return "";
    }

    return `https://www.sulpak.kz/g/${encodeURIComponent(normalizedArticle)}#characteristicsTab`;
}
