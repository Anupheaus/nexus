import { useState } from 'react';
import { useAction } from '../../../../src/client/hooks/useAction';
import { echoAction } from '../../../playwright/server/contracts';

export function ReactiveSection() {
  const [input, setInput] = useState('initial');
  const { useEcho } = useAction(echoAction);
  const { response, isLoading } = useEcho({ value: input });

  return (
    <section>
      <h2>Reactive Action</h2>
      <input
        data-testid="reactive-input"
        value={input}
        onChange={e => setInput(e.target.value)}
      />
      <div data-testid="reactive-loading">{isLoading ? 'loading' : 'idle'}</div>
      <div data-testid="reactive-result">{response ?? ''}</div>
    </section>
  );
}
