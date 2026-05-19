import { defineSubscription } from './defineSubscription';
import type { NexusSubscriptionRequest, NexusSubscriptionResponse } from './internalModels';


export const mxdbQuerySubscription = defineSubscription<NexusSubscriptionRequest, NexusSubscriptionResponse>()('mxdbQuerySubscription');
