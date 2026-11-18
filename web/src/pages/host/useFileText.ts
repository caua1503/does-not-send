import { useEffect, useState } from "react";

export function useFileText(download: string, enabled: boolean) {
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setTextContent(null);
    setTextError(null);
    fetch(download, { headers: { Accept: "text/plain" } })
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then((text) => {
        if (!cancelled) setTextContent(text);
      })
      .catch(() => {
        if (cancelled) return;
        setTextContent(null);
        setTextError("Não foi possível carregar o texto");
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, download]);

  return { textContent, textError };
}
