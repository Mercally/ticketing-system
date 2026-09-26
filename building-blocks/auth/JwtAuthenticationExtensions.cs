using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;

namespace TicketingPlatform.Auth;

/// <summary>
/// Validates the same HS256 JWT auth-service issues (see
/// services/auth-service/src/auth/infrastructure/security/token.service.ts) — shared secret,
/// claims "sub"/"email"/"roles", no issuer/audience set on either side. This is the first real
/// JWT enforcement in the system: neither YARP nor any downstream service validated tokens
/// before this (DECISIONS.md D17's Lambda-authorizer note, and the k8s secret.yaml files that
/// carried JWT_SECRET around unused for a while).
/// </summary>
public static class JwtAuthenticationExtensions
{
    public static WebApplicationBuilder AddJwtAuthentication(this WebApplicationBuilder builder)
    {
        var jwtSecret = builder.Configuration["JWT_SECRET"]
            ?? throw new InvalidOperationException("JWT_SECRET is required to validate auth-service's tokens.");

        builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(options =>
            {
                // Keep claim types exactly as auth-service issues them ("sub", "roles", ...) —
                // the JWT handler's default inbound claim map rewrites "sub" to a long XML/SOAP
                // ClaimTypes.NameIdentifier URI, which would silently break every
                // User.FindFirstValue("sub") call downstream.
                options.MapInboundClaims = false;
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = false, // auth-service sets no "iss" claim
                    ValidateAudience = false, // ...nor "aud"
                    ValidateLifetime = true,
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
                    NameClaimType = "sub",
                    RoleClaimType = "roles",
                };
            });

        builder.Services.AddAuthorization();

        return builder;
    }

    /// <summary>The authenticated buyer's id ("sub" claim) — auth-service's user id, byte-for-byte.</summary>
    public static Guid GetUserId(this ClaimsPrincipal user)
    {
        var sub = user.FindFirstValue("sub")
            ?? throw new InvalidOperationException("Authenticated principal has no \"sub\" claim.");
        return Guid.Parse(sub);
    }
}
