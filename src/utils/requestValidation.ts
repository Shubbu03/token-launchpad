import { Response } from "express";

export function badRequest(res: Response, message: string): void {
  res.status(400).json({ error: message });
}

export function parseNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseOptionalTrimmedString(
  value: unknown
): string | undefined | null {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    return null;
  }

  return value.trim();
}

export function parseBigIntInput(value: unknown): bigint | null {
  if (typeof value === "string" && value.trim() === "") {
    return null;
  }

  try {
    return BigInt(value as bigint | number | string);
  } catch {
    return null;
  }
}

export function parseNumberInput(value: unknown): number | null {
  if (typeof value === "string" && value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseIntegerInput(value: unknown): number | null {
  const parsed = parseNumberInput(value);

  if (parsed === null || !Number.isInteger(parsed)) {
    return null;
  }

  return parsed;
}

export function parseDateInput(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
