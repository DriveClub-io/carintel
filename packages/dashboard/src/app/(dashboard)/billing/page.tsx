"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import { Check, CreditCard, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface Organization {
  id: string;
  name: string;
  subscription_tier_id: string;
  subscription_status: string;
  stripe_customer_id: string | null;
}

interface Tier {
  id: string;
  name: string;
  monthly_price_cents: number;
  monthly_token_limit: number | null;
  rate_limit_per_minute: number;
}

// Define all available tiers with features for pricing display
const ALL_TIERS = [
  {
    id: "free",
    name: "Free",
    monthly_price_cents: 0,
    monthly_token_limit: 1000,
    rate_limit_per_minute: 10,
    features: ["1,000 requests/month", "10 req/min rate limit", "API access", "MCP access", "CLI access"],
    description: "For testing and small projects",
  },
  {
    id: "starter",
    name: "Starter",
    monthly_price_cents: 4900,
    monthly_token_limit: 50000,
    rate_limit_per_minute: 60,
    features: ["50,000 requests/month", "60 req/min rate limit", "API access", "MCP access", "CLI access", "Email support"],
    description: "For growing applications",
  },
  {
    id: "pro",
    name: "Pro",
    monthly_price_cents: 19900,
    monthly_token_limit: 500000,
    rate_limit_per_minute: 300,
    features: ["500,000 requests/month", "300 req/min rate limit", "API access", "MCP access", "CLI access", "Priority support"],
    description: "For production workloads",
    popular: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    monthly_price_cents: 0,
    monthly_token_limit: null,
    rate_limit_per_minute: 1000,
    features: ["Unlimited requests", "1000 req/min rate limit", "API access", "MCP access", "CLI access", "Dedicated support", "SLA guarantee", "Custom integrations"],
    description: "For large-scale deployments",
    enterprise: true,
  },
];

export default function BillingPage() {
  const { user, organizationId } = useAuth();
  const searchParams = useSearchParams();
  const [org, setOrg] = useState<Organization | null>(null);
  const [tier, setTier] = useState<Tier | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  // Check for success/canceled params from Stripe redirect
  const success = searchParams.get("success");
  const canceled = searchParams.get("canceled");

  useEffect(() => {
    if (success) {
      toast.success("Subscription updated successfully!");
      // Clear the URL params
      window.history.replaceState({}, "", "/billing");
    } else if (canceled) {
      toast.info("Checkout canceled");
      window.history.replaceState({}, "", "/billing");
    }
  }, [success, canceled]);

  useEffect(() => {
    async function loadBillingInfo() {
      if (!organizationId) {
        setLoading(false);
        return;
      }

      const supabase = createClient();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: orgData, error } = await (supabase.from("organizations") as any)
        .select("id, name, subscription_tier_id, subscription_status, stripe_customer_id, subscription_tiers(*)")
        .eq("id", organizationId)
        .single();

      if (error) {
        console.error("Error loading billing info:", error);
      }

      if (orgData) {
        setOrg(orgData as Organization);
        setTier(orgData.subscription_tiers as Tier | null);
      }

      setLoading(false);
    }

    loadBillingInfo();
  }, [organizationId]);

  async function handleCheckout(tierId: string) {
    if (!org || !user) return;

    setCheckoutLoading(tierId);
    try {
      const response = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: org.id,
          tierId,
          userId: user.id,
          userEmail: user.email,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create checkout session");
      }

      // Redirect to Stripe Checkout
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error("Checkout error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to start checkout");
    } finally {
      setCheckoutLoading(null);
    }
  }

  async function handleManageBilling() {
    if (!org) return;

    setPortalLoading(true);
    try {
      const response = await fetch("/api/stripe/create-portal-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: org.id }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create portal session");
      }

      // Redirect to Stripe Customer Portal
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error("Portal error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to open billing portal");
    } finally {
      setPortalLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-40 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!user || !org) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
          <p className="text-muted-foreground">
            Sign in to view your billing information
          </p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10">
            <CreditCard className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">
              Sign in to access billing
            </p>
            <Button asChild>
              <a href="/login">Sign In</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const currentTierIndex = ALL_TIERS.findIndex((t) => t.id === (tier?.id || "free"));
  // User has active paid subscription if they have a stripe customer and are not on free tier
  const hasActiveSubscription = org.stripe_customer_id && tier?.id && tier.id !== "free" && org.subscription_status === "active";

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
        <p className="text-muted-foreground">
          Manage your subscription and billing
        </p>
      </div>

      {/* Subscription Status Alert */}
      {org.subscription_status === "past_due" && (
        <Alert variant="destructive">
          <AlertTitle>Payment Past Due</AlertTitle>
          <AlertDescription>
            Your subscription payment is past due. Please update your payment method to avoid service interruption.
          </AlertDescription>
        </Alert>
      )}

      {org.subscription_status === "canceled" && tier?.id !== "free" && (
        <Alert>
          <AlertTitle>Subscription Canceled</AlertTitle>
          <AlertDescription>
            Your subscription has been canceled. You can continue using the service until the end of your billing period.
          </AlertDescription>
        </Alert>
      )}

      {/* Current Plan Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Current Plan</CardTitle>
          <CardDescription>
            Your organization is on the {tier?.name || "Free"} plan
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between py-2">
            <span className="text-muted-foreground">Plan</span>
            <div className="flex items-center gap-2">
              <span className="font-medium">{tier?.name || "Free"}</span>
              <Badge variant={org.subscription_status === "active" ? "default" : org.subscription_status === "past_due" ? "destructive" : "secondary"}>
                {org.subscription_status}
              </Badge>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between py-2">
            <span className="text-muted-foreground">Monthly Limit</span>
            <span>{tier?.monthly_token_limit?.toLocaleString() || "1,000"} requests</span>
          </div>
          <Separator />
          <div className="flex items-center justify-between py-2">
            <span className="text-muted-foreground">Rate Limit</span>
            <span>{tier?.rate_limit_per_minute || 10} req/min</span>
          </div>
          <Separator />
          <div className="flex items-center justify-between py-2">
            <span className="text-muted-foreground">Price</span>
            <span>
              {tier?.monthly_price_cents
                ? `$${(tier.monthly_price_cents / 100).toFixed(0)}/month`
                : "Free"}
            </span>
          </div>

          {/* Manage Billing Button - only show if they have a Stripe customer */}
          {org.stripe_customer_id && (
            <>
              <Separator />
              <div className="pt-2">
                <Button
                  onClick={handleManageBilling}
                  disabled={portalLoading}
                  variant="outline"
                  className="w-full"
                >
                  {portalLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    <>
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Manage Billing in Stripe
                    </>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground text-center mt-2">
                  Update payment method, view invoices, or cancel subscription
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Pricing Cards */}
      <div className="space-y-4">
        <div className="text-center">
          <h2 className="text-2xl font-bold tracking-tight">Choose Your Plan</h2>
          <p className="text-muted-foreground mt-1">
            Select the plan that best fits your needs
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {ALL_TIERS.map((planTier, index) => {
            const isCurrentPlan = tier?.id === planTier.id || (!tier && planTier.id === "free");
            const isPopular = "popular" in planTier && planTier.popular;
            const isEnterprise = "enterprise" in planTier && planTier.enterprise;
            const isFree = planTier.id === "free";
            const thisTierIndex = index;
            const isUpgrade = thisTierIndex > currentTierIndex;
            const isDowngrade = thisTierIndex < currentTierIndex;
            const isLoading = checkoutLoading === planTier.id;

            return (
              <Card
                key={planTier.id}
                className={`relative flex flex-col ${
                  isPopular ? "border-primary shadow-lg" : ""
                } ${isCurrentPlan ? "bg-muted/50" : ""}`}
              >
                {isPopular && (
                  <Badge
                    className="absolute -top-3 left-1/2 -translate-x-1/2"
                    variant="default"
                  >
                    Most Popular
                  </Badge>
                )}
                <CardHeader className="text-center pb-2">
                  <CardTitle className="text-xl">{planTier.name}</CardTitle>
                  <div className="mt-2">
                    {isEnterprise ? (
                      <div className="text-3xl font-bold">Custom</div>
                    ) : (
                      <>
                        <span className="text-3xl font-bold">
                          ${(planTier.monthly_price_cents / 100).toFixed(0)}
                        </span>
                        <span className="text-muted-foreground">/month</span>
                      </>
                    )}
                  </div>
                  <CardDescription className="mt-2">
                    {planTier.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex-1">
                  <ul className="space-y-2">
                    {planTier.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <Check className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <div className="p-6 pt-0">
                  {isCurrentPlan ? (
                    <Button className="w-full" variant="outline" disabled>
                      Current Plan
                    </Button>
                  ) : isDowngrade ? (
                    // For downgrades, use the billing portal if they have a subscription
                    hasActiveSubscription ? (
                      <Button
                        className="w-full"
                        variant="outline"
                        onClick={handleManageBilling}
                        disabled={portalLoading}
                      >
                        {portalLoading ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        Manage in Stripe
                      </Button>
                    ) : (
                      <Button className="w-full" variant="outline" disabled>
                        Downgrade Not Available
                      </Button>
                    )
                  ) : isEnterprise ? (
                    <Button className="w-full" variant="default" asChild>
                      <a href="mailto:support@carintel.io?subject=Enterprise%20Plan%20Inquiry">
                        Contact Sales
                      </a>
                    </Button>
                  ) : isFree ? (
                    // Free tier - manage via portal if they have subscription
                    hasActiveSubscription ? (
                      <Button
                        className="w-full"
                        variant="outline"
                        onClick={handleManageBilling}
                        disabled={portalLoading}
                      >
                        {portalLoading ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        Manage in Stripe
                      </Button>
                    ) : (
                      <Button className="w-full" variant="outline" disabled>
                        Current Plan
                      </Button>
                    )
                  ) : isUpgrade ? (
                    <Button
                      className="w-full"
                      variant="default"
                      onClick={() => handleCheckout(planTier.id)}
                      disabled={isLoading || !!checkoutLoading}
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Loading...
                        </>
                      ) : (
                        `Upgrade to ${planTier.name}`
                      )}
                    </Button>
                  ) : (
                    <Button
                      className="w-full"
                      variant="outline"
                      onClick={() => handleCheckout(planTier.id)}
                      disabled={isLoading || !!checkoutLoading}
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Loading...
                        </>
                      ) : (
                        "Get Started"
                      )}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>

        <div className="text-center pt-4">
          <p className="text-sm text-muted-foreground">
            Need help choosing? Contact us at{" "}
            <a href="mailto:support@carintel.io" className="text-primary hover:underline">
              support@carintel.io
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
