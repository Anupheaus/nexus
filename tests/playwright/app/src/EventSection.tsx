import { useState } from 'react';
import { useAction, useEvent } from '../../../../src/client/hooks';
import { triggerEventAction, testEvent } from '../../../playwright/server/contracts';

export function EventSection() {
  const { triggerEvent } = useAction(triggerEventAction);
  const setEventHandler = useEvent(testEvent);
  const [events, setEvents] = useState<string[]>([]);

  setEventHandler(({ message }) => {
    setEvents(prev => [...prev, message]);
  });

  const handleTrigger = () => {
    triggerEvent({ message: 'ping-' + Date.now() });
  };

  return (
    <section>
      <h2>Events</h2>
      <button data-testid="trigger-event-btn" onClick={handleTrigger}>Trigger Event</button>
      <ul data-testid="event-log">
        {events.map((msg, i) => (
          <li key={i} data-testid="event-item">{msg}</li>
        ))}
      </ul>
    </section>
  );
}
