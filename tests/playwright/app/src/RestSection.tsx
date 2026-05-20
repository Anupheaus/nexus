import { useState } from 'react';
import { useAction } from '../../../../src/client/hooks';
import { helloRestAction } from '../../../playwright/server/contracts';

export function RestSection() {
  const { helloRest } = useAction(helloRestAction);
  const [greeting, setGreeting] = useState('');

  const handleClick = async () => {
    try {
      const result = await helloRest({ name: 'World' });
      setGreeting(result.greeting);
    } catch (e: unknown) {
      setGreeting(`error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div>
      <h3>REST Mode</h3>
      <button data-testid="rest-btn" onClick={handleClick}>Call REST</button>
      <div data-testid="rest-result">{greeting}</div>
    </div>
  );
}
