export const PRODUCT_NAME = "FootLabOS";
export const PRODUCT_PRINCIPLE = "Technology is the crew. The person is the destination.";

export function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`);
}
