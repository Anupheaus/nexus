import React from 'react';
import { SocketAPI } from '../../../../src/client';
import { ConnectionSection } from './ConnectionSection';
import { ActionSection } from './ActionSection';
import { ReactiveSection } from './ReactiveSection';
import { EventSection } from './EventSection';
import { SubscriptionSection } from './SubscriptionSection';
import { RestSection } from './RestSection';

export function App() {
  return (
    <SocketAPI name="test">
      <div style={{ fontFamily: 'sans-serif', padding: 16 }}>
        <ConnectionSection />
        <ActionSection />
        <ReactiveSection />
        <EventSection />
        <SubscriptionSection />
        <RestSection />
      </div>
    </SocketAPI>
  );
}
