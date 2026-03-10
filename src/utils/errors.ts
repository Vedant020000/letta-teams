export function handleCliError(error: unknown, jsonMode: boolean): never {
  const message = error instanceof Error ? error.message : String(error);
  if (jsonMode) {
    console.error(JSON.stringify({ error: message }));
  } else {
    console.error(`Error: ${message}`);
  }
  process.exit(1);
}