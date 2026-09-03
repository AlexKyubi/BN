import { dom } from "../dom.js";

/**
 * Полноэкранный просмотрщик изображения товара.
 */

/** Открывает просмотрщик с изображением товара. */
export function openViewerWithImage(imageUrl, imageAlt) {
    dom.viewerImage.src = imageUrl;
    dom.viewerImage.alt = imageAlt || "";
    dom.viewerImage.classList.add("active");

    dom.viewer.classList.remove("hidden");
}

/** Закрывает просмотрщик изображения. */
export function hideViewer() {
    dom.viewer.classList.add("hidden");
    dom.viewerImage.classList.remove("active");
    dom.viewerImage.src = "";
    dom.viewerImage.alt = "";
}
