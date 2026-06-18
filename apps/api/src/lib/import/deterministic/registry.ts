import {
  type DeterministicImportAdapter,
  type DeterministicImportMatchInput,
  type DeterministicImportRegistry,
} from "./types";

export const createDeterministicImportRegistry = (
  adapters: DeterministicImportAdapter[] = [],
): DeterministicImportRegistry => ({
  select(input: DeterministicImportMatchInput) {
    return adapters.find((adapter) => adapter.match(input)) ?? null;
  },
});
