import { useEffect, useRef, useState } from "react";
import type { GuestUploadItem } from "../pages/guest/UploadItem.tsx";
import { compressPhoto, isCompressiblePhoto } from "../lib/compressPhoto.ts";
import { convertHeicToJpeg, isHeic } from "../lib/convertHeic.ts";
import { TaskQueue } from "../lib/taskQueue.ts";
import { RESUMABLE_UPLOAD_MIN_BYTES } from "../../../src/shared/resumable-upload.ts";
import { ApiError } from "../lib/api.ts";
import { newTransferId, resumableUpload } from "../lib/resumableUpload.ts";
import { BASE_URL } from "../lib/base.ts";
import { buildTextFile, TEXT_MAX_LENGTH } from "../lib/textFile.ts";

// Full-resolution decodes are memory-heavy on phones. Keep one in flight;
// two independent network slots allow the next file to start while one is uploading.
const decodeQueue = new TaskQueue(1);
const uploadQueue = new TaskQueue(2);

interface UseSessionUploadOptions {
  sessionId: string;
  credential: string;
  disabled: boolean;
  onClosed?: () => void;
}

/** Upload pipeline shared by the oneway guest page and the twoway room. */
function conflictMessage(xhr: XMLHttpRequest): string {
  try {
    if (JSON.parse(xhr.responseText).code === "UPLOAD_INTERRUPTED") return "Envio interrompido. Tente novamente.";
  } catch {
    // Some proxies return a non-JSON response.
  }
  return "Sessão não aceita envios";
}

export function useSessionUpload({
  sessionId,
  credential,
  disabled,
  onClosed,
}: UseSessionUploadOptions) {
  const [items, setItems] = useState<GuestUploadItem[]>([]);
  const [textError, setTextError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  const scope = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;
    return () => controller.abort();
  }, [sessionId, credential]);

  const enqueueUpload = (item: GuestUploadItem, task: (signal: AbortSignal) => Promise<void>) => {
    const signal = scope.current.signal;
    setItems((prev) => prev.map((current) => current.id === item.id
      ? { ...current, state: "pending", error: undefined }
      : current));
    void uploadQueue.run(async () => {
      if (signal.aborted || disabledRef.current) return;
      try {
        await task(signal);
      } catch (error) {
        if (signal.aborted) return;
        let message = "Sem conexão com o servidor";
        if (error instanceof ApiError) {
          if (error.status === 410) {
            onClosedRef.current?.();
            message = "Sessão encerrada";
          } else if (error.status === 413) {
            message = "Arquivo muito grande ou limite excedido";
          } else if (error.status === 507) {
            message = "Sem espaço para continuar o envio";
          } else if (error.status === 409) {
            message = "Envio interrompido. Tente novamente.";
          } else {
            message = error.message;
          }
        }
        setItems((prev) => prev.map((current) => current.id === item.id
          ? { ...current, state: "error", error: message }
          : current));
      }
    });
  };

  const enqueueMultipart = (item: GuestUploadItem, configure: (xhr: XMLHttpRequest) => FormData) =>
    enqueueUpload(item, (signal) => new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", cancel);
        resolve();
      };
      const cancel = () => {
        finish();
        xhr.abort?.();
      };
      const failed = () => {
        setItems((prev) => prev.map((current) => current.id === item.id
          ? { ...current, state: "error", error: "Sem conexão com o servidor" }
          : current));
      };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        const body = configure(xhr);
        if (signal.aborted) return;
        const onLoad = xhr.onload;
        const onError = xhr.onerror;
        xhr.onload = (event) => {
          try { if (!settled) onLoad?.call(xhr, event); } finally { finish(); }
        };
        xhr.onerror = (event) => {
          try { if (!settled) onError?.call(xhr, event); } finally { finish(); }
        };
        xhr.onabort = xhr.ontimeout = () => {
          if (!settled) failed();
          finish();
        };
        xhr.send(body);
      } catch {
        failed();
        finish();
      }
    }));

  const uploadLargeFile = (item: GuestUploadItem) => enqueueUpload(item, async (signal) => {
    setItems((prev) => prev.map((current) => current.id === item.id
      ? { ...current, state: "uploading", progress: 0 }
      : current));
    const remoteId = await resumableUpload({
      url: `${BASE_URL}/api/sessions/${sessionId}/transfers/${item.id}`,
      credential,
      file: item.file,
      originalSize: item.originalSize ?? item.file.size,
      signal,
      onProgress: (bytes) => {
        if (signal.aborted) return;
        setItems((prev) => prev.map((current) => current.id === item.id
          ? { ...current, progress: bytes / item.file.size }
          : current));
      },
    });
    if (signal.aborted) return;
    setItems((prev) => prev.map((current) => current.id === item.id
      ? { ...current, state: "completed", progress: 1, remoteId }
      : current));
  });

  const uploadSingleFile = (item: GuestUploadItem) => {
    if (item.kind !== "text" && item.file.size >= RESUMABLE_UPLOAD_MIN_BYTES) {
      uploadLargeFile(item);
      return;
    }
    enqueueMultipart(item, (xhr) => {
      setItems((prev) =>
        prev.map((current) =>
          current.id === item.id
            ? { ...current, state: "uploading", progress: 0, error: undefined }
            : current,
        ),
      );

      const formData = new FormData();
      // Field first: the server streams the file part and reads it before the bytes.
      formData.append("originalSize", String(item.originalSize ?? item.file.size));
      formData.append("files", item.file, item.file.name);

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const progress = event.loaded / event.total;
        setItems((prev) =>
          prev.map((current) => (current.id === item.id ? { ...current, progress } : current)),
        );
      };

      xhr.onload = () => {
        if (xhr.status === 201) {
          let remoteId: string | undefined;
          try {
            const body = JSON.parse(xhr.responseText) as { files?: Array<{ id?: string }> };
            remoteId = body.files?.[0]?.id;
          } catch {
            // resposta sem corpo válido: upload concluído, sem id remoto
          }
          setItems((prev) =>
            prev.map((current) =>
              current.id === item.id
                ? { ...current, state: "completed", progress: 1, remoteId }
                : current,
            ),
          );
          if (item.kind === "text") setTextError(null);
        } else if (xhr.status === 401) {
          setItems((prev) =>
            prev.map((current) =>
              current.id === item.id
                ? { ...current, state: "error", error: "Falha de autorização no envio" }
                : current,
            ),
          );
        } else if (xhr.status === 410) {
          onClosedRef.current?.();
          setItems((prev) =>
            prev.map((current) =>
              current.id === item.id
                ? { ...current, state: "error", error: "Sessão encerrada" }
                : current,
            ),
          );
        } else if (xhr.status === 404) {
          setItems((prev) =>
            prev.map((current) =>
              current.id === item.id
                ? { ...current, state: "error", error: "Sessão não encontrada" }
                : current,
            ),
          );
        } else if (xhr.status === 409) {
          setItems((prev) =>
            prev.map((current) =>
              current.id === item.id
                ? { ...current, state: "error", error: conflictMessage(xhr) }
                : current,
            ),
          );
        } else if (xhr.status === 400 || xhr.status === 429) {
          let message =
            xhr.status === 429 ? "Muitos textos enviados, aguarde um pouco" : "Texto inválido";
          try {
            const body = JSON.parse(xhr.responseText) as { error?: unknown };
            if (typeof body.error === "string") message = body.error;
          } catch {
            // resposta sem corpo válido: mantém a mensagem padrão
          }
          if (item.kind === "text") setTextError(message);
          setItems((prev) =>
            prev.map((current) =>
              current.id === item.id ? { ...current, state: "error", error: message } : current,
            ),
          );
        } else if (xhr.status === 413) {
          setItems((prev) =>
            prev.map((current) =>
              current.id === item.id
                ? {
                    ...current,
                    state: "error",
                    error: "Arquivo muito grande ou limite excedido",
                  }
                : current,
            ),
          );
        } else if (xhr.status >= 500 && xhr.status < 600) {
          setItems((prev) =>
            prev.map((current) =>
              current.id === item.id
                ? {
                    ...current,
                    state: "error",
                    error: "Servidor temporariamente indisponível",
                  }
                : current,
            ),
          );
        } else {
          setItems((prev) =>
            prev.map((current) =>
              current.id === item.id
                ? { ...current, state: "error", error: `Erro ${xhr.status}` }
                : current,
            ),
          );
        }
      };

      xhr.onerror = () => {
        setItems((prev) =>
          prev.map((current) =>
            current.id === item.id
              ? { ...current, state: "error", error: "Sem conexão com o servidor" }
              : current,
          ),
        );
      };

      xhr.open(
        "POST",
        `${BASE_URL}/api/sessions/${sessionId}/files${item.kind === "text" ? "?kind=text" : ""}`,
      );
      xhr.setRequestHeader("Authorization", `Bearer ${credential}`);
      return formData;
    });
  };

  const processAndUpload = async (item: GuestUploadItem) => {
    const signal = scope.current.signal;
    const heic = isHeic(item.file);
    try {
      const file = await decodeQueue.run(async () => {
        if (disabledRef.current || signal.aborted) return item.file;
        return heic ? convertHeicToJpeg(item.file) : compressPhoto(item.file);
      });
      if (disabledRef.current || signal.aborted) return;
      setItems((prev) => prev.map((current) =>
        current.id === item.id ? { ...current, file } : current,
      ));
      uploadSingleFile({ ...item, file });
    } catch {
      if (signal.aborted) return;
      setItems((prev) => prev.map((current) => current.id === item.id
        ? { ...current, state: "error", error: "Não foi possível converter a imagem HEIC" }
        : current));
    }
  };

  const handleFilesChosen = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (disabledRef.current) return;
    if (!event.target.files || event.target.files.length === 0) return;
    const fileList = Array.from(event.target.files);

    const newItems: GuestUploadItem[] = fileList.map((file) => ({
      id: newTransferId(),
      file,
      originalSize: file.size,
      progress: 0,
      state: isHeic(file) || isCompressiblePhoto(file) ? "optimizing" : "pending",
    }));

    setItems((prev) => [...prev, ...newItems]);
    if (fileInputRef.current) fileInputRef.current.value = "";

    newItems.forEach((item) => {
      if (item.state === "optimizing") {
        void processAndUpload(item);
      } else {
        uploadSingleFile(item);
      }
    });
  };

  const sendText = (raw: string): boolean => {
    if (disabledRef.current) return false;
    const text = raw.trim();
    if (!text) {
      setTextError("Texto não pode ser vazio");
      return false;
    }
    if (text.length > TEXT_MAX_LENGTH) {
      setTextError(`Texto excede o limite de ${TEXT_MAX_LENGTH} caracteres`);
      return false;
    }
    const file = buildTextFile(
      text,
      new Date(),
      items.map((item) => item.file.name),
    );
    const item: GuestUploadItem = {
      id: `text-${Date.now()}-${Math.random()}`,
      file,
      originalSize: file.size,
      progress: 0,
      state: "pending",
      kind: "text",
    };
    setTextError(null);
    setItems((prev) => [...prev, item]);
    uploadSingleFile(item);
    return true;
  };

  // PUT replaces the file content keeping the same remote id: no new item.
  const replaceEditedImage = (item: GuestUploadItem, file: File) => enqueueMultipart(item, (xhr) => {
    setItems((prev) =>
      prev.map((current) =>
        current.id === item.id
          ? { ...current, file, state: "uploading", progress: 0, error: undefined }
          : current,
      ),
    );
    const formData = new FormData();
    formData.append("originalSize", String(file.size));
    formData.append("files", file, file.name);
    const fail = (error: string) => {
      if (xhr.status === 410) onClosedRef.current?.();
      setItems((prev) =>
        prev.map((current) =>
          current.id === item.id ? { ...current, state: "error", error } : current,
        ),
      );
    };

    xhr.onload = () => {
      if (xhr.status !== 200) {
        if (xhr.status === 401) fail("Falha de autorização na edição");
        else if (xhr.status === 410) fail("Sessão encerrada");
        else if (xhr.status === 404) fail("Arquivo não encontrado");
        else if (xhr.status === 409) fail(conflictMessage(xhr));
        else if (xhr.status === 413) fail("Arquivo muito grande ou limite excedido");
        else if (xhr.status >= 500) fail("Servidor temporariamente indisponível");
        else fail(`Erro ${xhr.status}`);
        return;
      }
      setItems((prev) =>
        prev.map((current) =>
          current.id === item.id
            ? {
                ...current,
                file,
                state: "completed",
                progress: 1,
                originalSize: file.size,
                edited: true,
                error: undefined,
              }
            : current,
        ),
      );
    };
    xhr.onerror = () => fail("Sem conexão com o servidor");
    xhr.open("PUT", `${BASE_URL}/api/sessions/${sessionId}/files/${item.remoteId}`);
    xhr.setRequestHeader("Authorization", `Bearer ${credential}`);
    return formData;
  });

  const retryUpload = (id: string) => {
    const item = items.find((current) => current.id === id);
    if (!item) return;
    if (item.remoteId) {
      replaceEditedImage(item, item.file);
      return;
    }
    if (isHeic(item.file)) {
      setItems((prev) => prev.map((current) => current.id === item.id
        ? { ...current, state: "optimizing", error: undefined }
        : current));
      void processAndUpload(item);
    } else {
      uploadSingleFile(item);
    }
  };

  const totalFiles = items.length;
  const completedFiles = items.filter((item) => item.state === "completed").length;
  const isUploading = items.some(
    (item) =>
      item.state === "uploading" || item.state === "pending" || item.state === "optimizing",
  );

  return {
    items,
    textError,
    fileInputRef,
    handleFilesChosen,
    sendText,
    replaceEditedImage,
    retryUpload,
    totalFiles,
    completedFiles,
    isUploading,
  };
}
