import { defineAction } from '../../../src/common';

interface TestRequest {
  foo: string;
}

interface TestResponse {
  bar: string;
}

export const testEndpoint = defineAction<TestRequest, TestResponse>()('test');

interface SignInRequest {
  email: string;
  password: string;
}

export const signIn = defineAction<SignInRequest, boolean>()('signIn');
