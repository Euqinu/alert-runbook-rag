import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  databaseUrl: required("DATABASE_URL"),
  // A getter, so the key is only demanded when embeddings are actually used.
  // Scripts that only touch the database (like db:migrate) don't need it.
  get voyageApiKey(): string {
    return required("VOYAGE_API_KEY");
  },
  get anthropicApiKey(): string {
    return required("ANTHROPIC_API_KEY");
  },
};
