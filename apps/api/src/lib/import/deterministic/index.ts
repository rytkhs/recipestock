import { cookpadImportAdapter } from "./cookpad";
import { createDeterministicImporter } from "./importer";

export { createDeterministicImporter, type DeterministicImporter } from "./importer";

export const defaultDeterministicImporter = createDeterministicImporter([cookpadImportAdapter]);
