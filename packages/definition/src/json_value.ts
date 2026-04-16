export type JsonPrimitive = boolean | number | string | null;

export interface JsonArray extends Array<JsonValue> {}

export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
