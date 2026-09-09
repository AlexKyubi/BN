import { dom } from "../dom.js";
import { state } from "../state.js";
import { normalizeArticleSearchInput } from "../utils.js";
import { renderCards } from "../ui/grid.js";

/**
 * Сканер QR-кодов (на мобильных устройствах) для быстрого поиска товара по артикулу.
 */

let qrStream = null;
let qrScannerActive = false;
let isFrontCamera = false;

/** Определяет, что приложение открыто на мобильном устройстве (по user-agent или ширине экрана). */
function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
        || window.innerWidth <= 650;
}

/** Извлекает id товара из QR-ссылки вида https://www.sulpak.kz/g/460033?S55. */
function extractArticleFromUrl(url) {
    const match = url.match(/\/g\/(\d+)/);
    return match ? match[1] : null;
}

/** Подставляет распознанный артикул в поле поиска и обновляет сетку. */
function insertArticleToSearch(articleId) {
    const normalizedArticleId = normalizeArticleSearchInput(articleId);
    dom.search.value = normalizedArticleId;
    state.searchQuery = normalizedArticleId;
    renderCards();
}

/** Читает кадры видео с камеры и ищет в них QR-код (пока сканер активен). */
function scanQrCode() {
    const qrVideo = dom.qrVideo;
    const qrStatus = dom.qrStatus;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    let noDataFrames = 0;

    const scanInterval = setInterval(() => {
        if (!qrScannerActive) {
            clearInterval(scanInterval);
            return;
        }

        if (qrVideo.readyState === qrVideo.HAVE_ENOUGH_DATA) {
            noDataFrames = 0;

            try {
                canvas.width = qrVideo.videoWidth;
                canvas.height = qrVideo.videoHeight;

                if (canvas.width === 0 || canvas.height === 0) {
                    return;
                }

                if (isFrontCamera) {
                    // Зеркалим кадр только для фронтальной камеры, чтобы совпадало с превью.
                    ctx.save();
                    ctx.scale(-1, 1);
                    ctx.drawImage(qrVideo, -canvas.width, 0, canvas.width, canvas.height);
                    ctx.restore();
                } else {
                    ctx.drawImage(qrVideo, 0, 0, canvas.width, canvas.height);
                }

                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = window.jsQR(imageData.data, imageData.width, imageData.height);

                if (code) {
                    const articleId = extractArticleFromUrl(code.data);
                    if (articleId) {
                        insertArticleToSearch(articleId);
                        stopQrScanner();
                        clearInterval(scanInterval);
                    } else {
                        qrStatus.textContent = "QR код не содержит валидную ссылку. Попробуйте ещё.";
                    }
                }
            } catch (err) {
                console.error("Ошибка при сканировании QR:", err);
            }
        } else {
            noDataFrames++;
            if (noDataFrames > 30) {
                qrStatus.textContent = "Видео не загружается. Проверьте разрешения камеры.";
            }
        }
    }, 300);
}

/** Запрашивает доступ к камере и запускает сканирование QR-кода. */
export async function startQrScanner() {
    if (!isMobileDevice()) {
        alert("QR сканер доступен только на мобильных устройствах.");
        return;
    }

    if (typeof window.jsQR !== "function") {
        dom.qrScannerModal?.classList.remove("hidden");
        if (dom.qrStatus) {
            dom.qrStatus.textContent = "Модуль QR-сканера не загрузился. Проверьте интернет и обновите страницу.";
        }
        return;
    }

    const qrScannerModal = dom.qrScannerModal;
    const qrVideo = dom.qrVideo;
    const qrStatus = dom.qrStatus;

    qrScannerModal.classList.remove("hidden");
    qrScannerActive = true;
    qrStatus.textContent = "Инициализация камеры...";

    try {
        const constraints = {
            video: {
                facingMode: "environment",
                width: { ideal: 1280 },
                height: { ideal: 720 },
            },
            audio: false,
        };

        qrStream = await navigator.mediaDevices.getUserMedia(constraints);
        qrVideo.srcObject = qrStream;

        const videoTrack = qrStream.getVideoTracks()[0];
        const settings = videoTrack.getSettings();
        isFrontCamera = settings.facingMode === "user";

        if (isFrontCamera) {
            qrVideo.style.transform = "scaleX(-1)";
        } else {
            qrVideo.style.transform = "none";
        }

        qrVideo.onloadedmetadata = function () {
            qrVideo.play().catch((err) => {
                console.error("Ошибка при воспроизведении видео:", err);
                qrStatus.textContent = "Ошибка воспроизведения видео.";
            });
        };

        qrStatus.textContent = "Наведите камеру на QR код...";
        scanQrCode();
    } catch (error) {
        console.error("Ошибка доступа к камере:", error);
        let errorMsg = "Не удалось открыть камеру.";

        if (error.name === "NotAllowedError") {
            errorMsg = "Разрешение на доступ к камере отклонено. Проверьте настройки браузера.";
        } else if (error.name === "NotFoundError") {
            errorMsg = "Камера не найдена на устройстве.";
        } else if (error.name === "NotReadableError") {
            errorMsg = "Камера занята другим приложением.";
        } else if (error.name === "SecurityError") {
            errorMsg = "Требуется защищённое соединение (HTTPS) для доступа к камере.";
        }

        qrStatus.textContent = errorMsg;
        qrScannerActive = false;
    }
}

/** Останавливает сканер и отключает камеру. */
export function stopQrScanner() {
    qrScannerActive = false;

    if (qrStream) {
        qrStream.getTracks().forEach((track) => track.stop());
        qrStream = null;
    }

    dom.qrVideo.srcObject = null;
    dom.qrScannerModal.classList.add("hidden");
}

/** Подключает кнопки открытия/закрытия сканера QR-кодов. */
export function initQrScanner() {
    dom.scanQrBtn?.addEventListener("click", startQrScanner);
    dom.closeQrScannerBtn?.addEventListener("click", stopQrScanner);
    dom.stopQrScannerBtn?.addEventListener("click", stopQrScanner);
}
