import { expect, jest, test, it, beforeEach, describe } from '@jest/globals';
import { loadStripe } from '@stripe/stripe-js';

describe('stripe mock', () => {
    let stripe;

    beforeEach(() => {
        stripe = loadStripe("");
    })

    // Please customize test cases below
    it('loadStripe mock function should provide access to elements and confirmPayment', async () => {
        expect(stripe.elements).toBeDefined();
        expect(stripe.confirmPayment).toBeDefined();
    });
});
