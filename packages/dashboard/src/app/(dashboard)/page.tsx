"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import Link from "next/link";
import { ArrowRight, Key, TrendingUp, TrendingDown, BarChart3 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface UsageStats {
  totalRequests: number;
  remainingQuota: number;
  monthlyLimit: number;
  recentRequests: number;
  percentChange: number;
}

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStats() {
      if (authLoading) return;

      if (!user) {
        setLoading(false);
        return;
      }

      try {
        // TODO: Fetch real usage data when organizations/usage tables exist
        const monthlyLimit = 1000;

        setStats({
          totalRequests: 0,
          remainingQuota: monthlyLimit,
          monthlyLimit,
          recentRequests: 0,
          percentChange: 0,
        });
      } catch (err) {
        console.error("[Dashboard] Error loading stats:", err);
      } finally {
        setLoading(false);
      }
    }

    loadStats();
  }, [user, authLoading]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-20 mb-2" />
                <Skeleton className="h-3 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Welcome to Car Intel</h1>
          <p className="text-muted-foreground">
            Sign in to view your API usage statistics
          </p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10">
            <p className="text-muted-foreground mb-4">
              Get started with Car Intel API
            </p>
            <Button asChild>
              <Link href="/login">
                Sign In <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const usagePercent = Math.round((stats.totalRequests / stats.monthlyLimit) * 100);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome back! Here's an overview of your API usage.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Plan Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Current Plan</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold">Developer</span>
              <Button variant="outline" size="sm" asChild>
                <Link href="/settings">Upgrade</Link>
              </Button>
            </div>
            <Progress value={usagePercent} className="h-2" />
            <p className="text-xs text-muted-foreground">
              {stats.totalRequests.toLocaleString()} of {stats.monthlyLimit.toLocaleString()} API calls used
            </p>
          </CardContent>
        </Card>

        {/* API Calls This Month */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription>This Month</CardDescription>
              <Badge variant={stats.percentChange >= 0 ? "default" : "secondary"} className="text-xs">
                {stats.percentChange >= 0 ? (
                  <TrendingUp className="mr-1 h-3 w-3" />
                ) : (
                  <TrendingDown className="mr-1 h-3 w-3" />
                )}
                {Math.abs(stats.percentChange)}%
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.totalRequests.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">API requests</p>
          </CardContent>
        </Card>

        {/* Remaining Quota */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Remaining Quota</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.remainingQuota.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              of {stats.monthlyLimit.toLocaleString()} available
            </p>
          </CardContent>
        </Card>

        {/* Last 7 Days */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Last 7 Days</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.recentRequests.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">requests</p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              API Keys
            </CardTitle>
            <CardDescription>
              Manage your API keys and create new ones
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/keys">
                Manage Keys <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Usage Analytics
            </CardTitle>
            <CardDescription>
              View detailed analytics and usage reports
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" asChild>
              <Link href="/usage">
                View Analytics <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
