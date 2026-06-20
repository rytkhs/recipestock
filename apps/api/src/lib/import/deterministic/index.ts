import { cookpadImportAdapter } from "./cookpad";
import { delishKitchenImportAdapter } from "./delish-kitchen";
import { createDeterministicImporter } from "./importer";
import { kurashiruImportAdapter } from "./kurashiru";

export { createDeterministicImporter, type DeterministicImporter } from "./importer";

export const defaultDeterministicImporter = createDeterministicImporter([
  cookpadImportAdapter,
  delishKitchenImportAdapter,
  kurashiruImportAdapter,
]);
