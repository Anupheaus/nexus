import React, { useState } from 'react';
import { useAction } from '../../../../src/client/hooks/useAction';
import { echoAction, errorAction } from '../../../playwright/server/contracts';

export function ActionSection() {
  const { echo } = useAction(echoAction);
  const { error: errorFn } = useAction(errorAction);
  const [result, setResult] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

  const handleEcho = async () => {
    try {
      const response = await echo({ value: 'hello' });
      setResult(response);
    } catch (e: any) {
      setResult('error: ' + e.message);
    }
  };

  const handleError = async () => {
    try {
      await errorFn(undefined);
      setErrorMsg('no error');
    } catch (e: any) {
      setErrorMsg(e.message);
    }
  };

  return (
    <section>
      <h2>Actions</h2>
      <button data-testid="echo-btn" onClick={handleEcho}>Echo</button>
      <div data-testid="echo-result">{result}</div>
      <button data-testid="error-btn" onClick={handleError}>Trigger Error</button>
      <div data-testid="error-result">{errorMsg}</div>
    </section>
  );
}
