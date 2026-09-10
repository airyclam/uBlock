/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2019-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

import { proxyApplyFn } from './proxy-apply.js';
import { registerScriptlet } from './base.js';
import { runAt } from './run-at.js';
import { safeSelf } from './safe-self.js';

/******************************************************************************/

/**
 * @scriptlet prevent-constructor
 * 
 * @description
 * Conditionally prevent a constructor call if the constructor name and
 * optionally its arguments match the specified criteria.
 * 
 * @param constructorName
 * The name of the constructor to prevent, e.g. `Promise` or
 * `MutationObserver`.
 * 
 * @param [argumentsMatch]
 * Optional. A pattern or regex to match against the first argument passed to
 * the constructor. A JSON array can be used to match arguments positionally.
 * Use `*` to skip an argument position.
 * 
 * @usage:
 * example.com##+js(prevent-constructor, MutationObserver)
 * example.com##+js(prevent-constructor, Promise, adblock)
 * example.com##+js(prevent-constructor, MutationObserver, /detect.*ad/)
 * example.com##+js(prevent-constructor, Foo, ["*", "attributes"])
 * 
 * Adapted from https://github.com/AdguardTeam/Scriptlets/blob/master/src/scriptlets/prevent-constructor.ts
 * */

export function preventConstructor(
    constructorName = '',
    argumentsMatch = '',
    ...varargs
) {
    const safe = safeSelf();
    const extraArgs = safe.parseVarargs(varargs);
    const logPrefix = safe.makeLogPrefix(
        'prevent-constructor',
        constructorName,
        argumentsMatch
    );

    if ( constructorName === '' ) { return; }

    const nativeConstructor = globalThis[constructorName];

    if ( typeof nativeConstructor !== 'function' ) {
        safe.uboLog(
            logPrefix,
            `"${constructorName}" is not a function`
        );
        return;
    }

    let arrayArgPatterns = null;
    const trimmedArgumentsMatch = argumentsMatch.trim();

    if (
        trimmedArgumentsMatch.startsWith('[') &&
        trimmedArgumentsMatch.endsWith(']')
    ) {
        try {
            const parsed = JSON.parse(argumentsMatch);
            if ( Array.isArray(parsed) === false ) {
                safe.uboLog(
                    logPrefix,
                    'Invalid argumentsMatch: not an array'
                );
                return;
            }
            arrayArgPatterns = parsed.map(
                pattern => String(pattern)
            );
        } catch {
            safe.uboLog(
                logPrefix,
                `Invalid JSON in argumentsMatch: ${argumentsMatch}`
            );
            return;
        }
    }

    const arrayArgRegexps = arrayArgPatterns === null
        ? null
        : arrayArgPatterns.map(
            pattern => pattern === '*'
                ? null
                : safe.patternToRegex(pattern)
        );

    const reArgument = arrayArgPatterns === null &&
        argumentsMatch !== ''
        ? safe.patternToRegex(argumentsMatch)
        : null;

    const stringifyArgument = arg => {
        try {
            if ( typeof arg === 'function' ) {
                return String(safe.Function_toString(arg));
            }
            if ( typeof arg === 'object' && arg !== null ) {
                try {
                    return JSON.stringify(arg);
                } catch {
                    return String(arg);
                }
            }
            return String(arg);
        } catch {
            return '';
        }
    };

    const matchesArguments = args => {
        if ( argumentsMatch === '' ) { return true; }

        if ( arrayArgPatterns !== null ) {
            for (
                let i = 0;
                i < arrayArgPatterns.length;
                i++
            ) {
                const pattern = arrayArgPatterns[i];
                if ( pattern === '*' ) { continue; }
                if ( i >= args.length ) { return false; }

                const argStr = stringifyArgument(args[i]);
                const regexp = arrayArgRegexps[i];

                if ( safe.RegExp_test(regexp, argStr) === false ) {
                    return false;
                }
            }
            return true;
        }

        const firstArg = stringifyArgument(args[0]);

        return safe.RegExp_test(
            reArgument,
            firstArg
        );
    };

    let isMatchingSuspended = false;

    const proxyFn = function(context) {
        const { callFn, callArgs } = context;

        if ( isMatchingSuspended ) {
            return context.reflect();
        }

        let shouldPrevent = false;
        isMatchingSuspended = true;

        try {
            shouldPrevent = matchesArguments(callArgs);
        } finally {
            isMatchingSuspended = false;
        }

        if ( shouldPrevent === false ) {
            return context.reflect();
        }

        safe.uboLog(
            logPrefix,
            `Prevented: ${constructorName}`
        );

        try {
            return Reflect.construct(
                callFn,
                [noopFunc]
            );
        } catch {
            return Object.create(
                callFn.prototype || null
            );
        }
    };

    runAt(( ) => {
        proxyApplyFn(
            constructorName,
            proxyFn
        );
    }, extraArgs.runAt);
}

function noopFunc() {
}

registerScriptlet(preventConstructor, {
    name: 'prevent-constructor.js',
    dependencies: [
        proxyApplyFn,
        runAt,
        safeSelf,
    ],
});

