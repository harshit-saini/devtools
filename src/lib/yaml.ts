// YAML values need quoting/escaping whenever they contain characters that are significant to the
// YAML grammar - otherwise e.g. {"key": "a: b"} becomes `key: a: b`, which either fails to parse
// back or reparses to a different value than the original JSON.
const YAML_NEEDS_QUOTING = /^[\s]|[\s]$|^[-?:,[\]{}#&*!|>'"%@`]|: |:$|^$|[\n\t]/;

export function formatYamlScalar(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  const text = String(value);
  if (YAML_NEEDS_QUOTING.test(text)) {
    return JSON.stringify(text);
  }

  return text;
}

export function toYaml(value: unknown, indent = 0): string {
  const space = "  ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${space}[]`;
    }

    return value
      .map((item) => {
        if (item && typeof item === "object") {
          return `${space}- ${toYaml(item, indent + 1).trimStart()}`;
        }
        return `${space}- ${formatYamlScalar(item)}`;
      })
      .join("\n");
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return `${space}{}`;
    }

    return entries
      .map(([key, item]) => {
        const formattedKey = YAML_NEEDS_QUOTING.test(key) ? JSON.stringify(key) : key;
        if (item && typeof item === "object") {
          return `${space}${formattedKey}:\n${toYaml(item, indent + 1)}`;
        }
        return `${space}${formattedKey}: ${formatYamlScalar(item)}`;
      })
      .join("\n");
  }

  return `${space}${formatYamlScalar(value)}`;
}
