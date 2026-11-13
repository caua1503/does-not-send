export const TEXT_MAX_LENGTH = 10_000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** "Texto 14-32-05.txt", with " (2)" when the same second is reused. */
export function textFileName(date: Date, existingNames: Iterable<string>): string {
  const base = `Texto ${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  const used = new Set(existingNames);
  let counter = 1;
  let name = `${base}.txt`;
  while (used.has(name)) {
    counter += 1;
    name = `${base} (${counter}).txt`;
  }
  return name;
}

export function buildTextFile(
  text: string,
  date: Date,
  existingNames: Iterable<string>,
): File {
  return new File([text], textFileName(date, existingNames), {
    type: "text/plain; charset=utf-8",
  });
}
