function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Открывает системное меню отправки; если отправка файлов недоступна — сохраняет файл. */
export async function shareOrDownload(blob, filename, title) {
    try {
        const file = typeof File === "function" ? new File([blob], filename, { type: blob.type }) : null;
        if (file && navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
            await navigator.share({ files: [file], title });
            return "shared";
        }
    } catch (error) {
        if (error?.name === "AbortError") {
            return "dismissed";
        }
        console.warn("Системная отправка файла недоступна:", error);
    }
    downloadBlob(blob, filename);
    return "downloaded";
}
