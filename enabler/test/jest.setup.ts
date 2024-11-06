/**import { jest } from '@jest/globals';
import fetchMock from 'jest-fetch-mock';

fetchMock.enableMocks();

jest.mock("../src/constants", () => {
    const fs = require('fs');
    const envFile = fs.readFileSync('.env.test', 'utf8');

    let envLines = envFile.split('\n');

    return envLines.reduce((prev, curr) => {
        const [key, value] = curr.split('=');
        if (!key)
            return {...prev}
        return {
            ...prev,
            [key.trim()] : value.trim()
        }
    }, {});
})

jest.mock("@stripe/stripe-js", () => {
    const { jest } = require('@jest/globals');

    return {
        loadStripe : jest.fn((_secret : string) => {
            return  {
                elements : jest.fn().mockImplementation(() => {
                    return {
                        create : (elementType, _options) => {
                            switch(elementType) {
                                case 'payment':
                                    return jest.fn().mockImplementation(() => {
                                        return {
                                            mount : (_selector) => {},
                                            on : (_evt, _cb) => {},
                                        }
                                    });
                                case 'expressCheckout':
                                    return jest.fn().mockImplementation(() => {
                                        return {
                                            mount : (_selector) => {},
                                            on : (_evt, _cb) => {},
                                        }
                                    });
                            }
                        },
                        submit : () => Promise.resolve({})
                    }
                }),
                confirmPayment : (_options) => {
                    return Promise.resolve({})
                },
            }
        })
    }
})**/


