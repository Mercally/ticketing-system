// API Gateway TOKEN authorizer — validates the same HS256 JWT auth-service issues
// (JWT_SECRET, shared byte-for-byte with the k8s secrets per DECISIONS.md/ARCHITECTURE.md's
// note on auth-service/secret.yaml). This is NEW enforcement, not a relocation of existing
// logic: as of this change, neither the YARP Gateway nor ticketing/orders validate JWTs
// themselves (see docs/adr — ticketing/orders' own JWT_SECRET was provisioned but unused).
'use strict';

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

function policy(principalId, effect, resource, context) {
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: effect,
          Resource: resource,
        },
      ],
    },
    context,
  };
}

exports.handler = async (event) => {
  const raw = event.authorizationToken || '';
  const token = raw.startsWith('Bearer ') ? raw.slice('Bearer '.length) : raw;

  if (!token) {
    throw new Error('Unauthorized');
  }

  try {
    const claims = jwt.verify(token, JWT_SECRET);
    // sub = user id, matches what auth-service puts in its own JwtPayload (JwtPayload.ts).
    return policy(String(claims.sub ?? 'unknown'), 'Allow', event.methodArn, {
      sub: String(claims.sub ?? ''),
      email: String(claims.email ?? ''),
    });
  } catch {
    // API Gateway TOKEN authorizers only support two outcomes: throwing "Unauthorized" (-> 401)
    // or returning an explicit Deny policy (-> 403). Invalid/expired tokens are treated the same
    // as missing ones — 401 — rather than leaking whether a token was present but bad.
    throw new Error('Unauthorized');
  }
};
