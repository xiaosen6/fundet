// drizzle-kit 配置：从 src/main/db/schema.ts 生成 migration 到 ./drizzle/
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/db/schema.ts',
  out: './drizzle',
});
