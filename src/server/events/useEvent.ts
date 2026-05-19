import type { NexusEvent } from '../../common';
import { eventPrefix } from '../../common/internalModels';
import { useClient } from '../providers';

export function useEvent<T>(event: NexusEvent<T>) {
  const client = useClient();

  return async (payload: T) => {
    if (client == null) throw new Error('useEvent requires an active client connection');
    await client.emitWithAck(`${eventPrefix}.${event.name}`, payload);
  };
}
