/**
 * Base pública do app, injetada pelo Vite (`__BASE_URL__`, vazia por padrão).
 * O `typeof` cobre ambientes em que a constante não é definida.
 */
declare const __BASE_URL__: string;

export const BASE_URL = typeof __BASE_URL__ !== "undefined" ? __BASE_URL__ : "";
