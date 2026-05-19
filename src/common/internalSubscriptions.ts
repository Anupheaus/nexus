import { defineSubscription } from './defineSubscription';
import type { SocketAPISubscriptionRequest, SocketAPISubscriptionResponse } from './internalModels';


export const mxdbQuerySubscription = defineSubscription<SocketAPISubscriptionRequest, SocketAPISubscriptionResponse>()('mxdbQuerySubscription');
