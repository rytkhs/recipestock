import { cookpadImportAdapter } from "./cookpad";
import { delishKitchenImportAdapter } from "./delish-kitchen";
import { createDeterministicImporter } from "./importer";

export { createDeterministicImporter, type DeterministicImporter } from "./importer";

export const defaultDeterministicImporter = createDeterministicImporter([
  cookpadImportAdapter,
  delishKitchenImportAdapter,
]);
