// export { default } from "../../vitest.config.mjs";
import { mergeConfig } from "vitest/config";

import sharedConfig from "../../vitest.config.mjs";

export default mergeConfig(sharedConfig, {
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
