import { useRef, useState } from "react";
import type { GuestUploadItem } from "../pages/guest/UploadItem.tsx";
import { compressPhoto, isCompressiblePhoto } from "../lib/compressPhoto.ts";
import { convertHeicToJpeg, isHeic } from "../lib/convertHeic.ts";
import { BASE_URL } from "../lib/base.ts";
import { buildTextFile, TEXT_MAX_LENGTH } from "../lib/textFile.ts";

interface UseSessionUploadOptions {
  sessionId: string;
  credential: string;
  disabled: boolean;
  onClosed?: () => void;
}

/** Upload pipeline shared by the oneway guest page and the twoway room. */
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

  const uploadSingleFile = (item: GuestUploadItem) => {
    if (disabledRef.current) return;

    setItems((prev) =>
      prev.map((current) =>
        current.id === item.id
          ? { ...current, state: "uploading", progress: 0, error: undefined }
          : current,
      ),
    );

    const xhr = new XMLHttpRequest();
    const formData = new FormData();
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
              ? { ...current, state: "error", error: "Sessão não aceita envios" }
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
    xhr.send(formData);
  };

  const processAndUpload = async (id: string, initialFile: File) => {
    if (disabledRef.current) return;

    let finalFile = initialFile;
    try {
      finalFile = await compressPhoto(initialFile);
    } catch {
      finalFile = initialFile;
    }

    if (disabledRef.current) return;

    try {
      finalFile = await convertHeicToJpeg(finalFile);
    } catch {
      setItems((prev) =>
        prev.map((current) =>
          current.id === id
            ? {
                ...current,
                state: "error",
                error: "Não foi possível converter a imagem HEIC",
              }
            : current,
        ),
      );
      return;
    }

    setItems((prev) =>
      prev.map((current) =>
        current.id === id
          ? { ...current, file: finalFile, state: "uploading", progress: 0 }
          : current,
      ),
    );

    uploadSingleFile({ id, file: finalFile, progress: 0, state: "uploading" });
  };

  const handleFilesChosen = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (disabledRef.current) return;
    if (!event.target.files || event.target.files.length === 0) return;
    const fileList = Array.from(event.target.files);

    const newItems: GuestUploadItem[] = fileList.map((file) => ({
      id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
      file,
      progress: 0,
      state: isHeic(file) || isCompressiblePhoto(file) ? "optimizing" : "pending",
    }));

    setItems((prev) => [...prev, ...newItems]);
    if (fileInputRef.current) fileInputRef.current.value = "";

    newItems.forEach((item) => {
      if (item.state === "optimizing") {
        void processAndUpload(item.id, item.file);
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
  const replaceEditedImage = (item: GuestUploadItem, file: File) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
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
        else if (xhr.status === 409) fail("Sessão não aceita envios");
        else if (xhr.status === 413) fail("Arquivo muito grande ou limite excedido");
        else if (xhr.status >= 500) fail("Servidor temporariamente indisponível");
        else fail(`Erro ${xhr.status}`);
        return;
      }
      setItems((prev) =>
        prev.map((current) =>
          current.id === item.id
            ? { ...current, file, edited: true, error: undefined }
            : current,
        ),
      );
    };
    xhr.onerror = () => fail("Sem conexão com o servidor");
    xhr.open("PUT", `${BASE_URL}/api/sessions/${sessionId}/files/${item.remoteId}`);
    xhr.setRequestHeader("Authorization", `Bearer ${credential}`);
    xhr.send(formData);
  };

  const retryUpload = (id: string) => {
    const item = items.find((current) => current.id === id);
    if (!item) return;
    if (item.remoteId) {
      setItems((prev) =>
        prev.map((current) =>
          current.id === item.id
            ? { ...current, state: "uploading", error: undefined }
            : current,
        ),
      );
      replaceEditedImage(item, item.file);
      return;
    }
    uploadSingleFile(item);
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
