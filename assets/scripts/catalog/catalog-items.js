import { DEFAULT_MONTH_COLUMN_INDEX } from "../config.js";
import { parsePercent, parseRating } from "../utils.js";

/** Создаёт карточку: идентичность товара из справочника, процент — из строки CSV. */
export function buildItem(product, ratingIndex) {
    const row = Array.isArray(product?.commissionRow) ? product.commissionRow : [];
    const rawRating = ratingIndex >= 0 ? row[ratingIndex] : "";
    let percent = parsePercent(rawRating);
    if (percent == null && ratingIndex === DEFAULT_MONTH_COLUMN_INDEX) percent = 0;
    return {
        article: String(product?.article || "").trim(),
        title: String(product?.title || product?.article || "").trim(),
        category: String(product?.category || "Без категории").trim(),
        stars: parseRating(rawRating),
        percent: percent ?? 0,
        image: "",
    };
}

export function buildSulpakCharacteristicsUrl(article) {
    const normalizedArticle = String(article || "").trim().replace(/^#+/, "");
    return normalizedArticle ? `https://www.sulpak.kz/g/${encodeURIComponent(normalizedArticle)}#characteristicsTab` : "";
}
