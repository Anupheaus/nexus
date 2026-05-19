import { is, to } from '@anupheaus/common';

export function deconstruct(data: unknown): unknown {
  return is.plainObject(data) ? to.serialise(data) : data;
}
