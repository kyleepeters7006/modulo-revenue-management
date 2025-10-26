import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { History, RotateCcw, AlertCircle, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface PricingHistoryRecord {
  id: string;
  appliedAt: string;
  actionType: string;
  serviceLine: string | null;
  unitsAffected: number;
  changesSnapshot: any[];
  description: string;
  userId: string | null;
}

export default function PricingHistory() {
  const { toast } = useToast();
  const [revertDialogOpen, setRevertDialogOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<PricingHistoryRecord | null>(null);

  const { data: history, isLoading } = useQuery<PricingHistoryRecord[]>({
    queryKey: ["/api/pricing-history"],
  });

  const revertMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest(`/api/pricing-history/${id}/revert`, "POST");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rate-card"] });
      toast({
        title: "Pricing Reverted",
        description: "The pricing changes have been successfully reverted.",
      });
      setRevertDialogOpen(false);
      setSelectedRecord(null);
    },
    onError: () => {
      toast({
        title: "Revert Failed",
        description: "Failed to revert the pricing changes. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleRevertClick = (record: PricingHistoryRecord) => {
    setSelectedRecord(record);
    setRevertDialogOpen(true);
  };

  const handleConfirmRevert = () => {
    if (selectedRecord) {
      revertMutation.mutate(selectedRecord.id);
    }
  };

  const getActionBadge = (actionType: string) => {
    switch (actionType) {
      case "accept_modulo":
        return <Badge className="bg-teal-500 hover:bg-teal-600 text-white">Modulo</Badge>;
      case "accept_ai":
        return <Badge className="bg-purple-500 hover:bg-purple-600 text-white">AI</Badge>;
      case "manual":
        return <Badge variant="secondary">Manual</Badge>;
      default:
        return <Badge variant="outline">{actionType}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Pricing Change History
          </CardTitle>
          <CardDescription>Loading pricing history...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <>
      <Card data-testid="card-pricing-history">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Pricing Change History
          </CardTitle>
          <CardDescription>
            Last 10 pricing changes with revert capability
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!history || history.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <AlertCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No pricing changes recorded yet</p>
              <p className="text-sm mt-1">Changes will appear here when you accept pricing suggestions</p>
            </div>
          ) : (
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-3">
                {history.map((record) => (
                  <div
                    key={record.id}
                    className="border rounded-lg p-4 hover:bg-gray-50 transition-colors"
                    data-testid={`history-record-${record.id}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          {getActionBadge(record.actionType)}
                          {record.serviceLine && (
                            <Badge variant="outline">{record.serviceLine}</Badge>
                          )}
                          <span className="text-sm text-gray-600">
                            {format(new Date(record.appliedAt), "MMM d, yyyy 'at' h:mm a")}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-gray-900 mb-1">
                          {record.description}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <CheckCircle2 className="h-3 w-3" />
                          <span>{record.unitsAffected} units affected</span>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRevertClick(record)}
                        disabled={revertMutation.isPending}
                        className="shrink-0"
                        data-testid={`button-revert-${record.id}`}
                      >
                        <RotateCcw className="h-4 w-4 mr-1" />
                        Revert
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={revertDialogOpen} onOpenChange={setRevertDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revert Pricing Changes?</AlertDialogTitle>
            <AlertDialogDescription>
              This will restore the pricing to the state before this change was applied.
              {selectedRecord && (
                <div className="mt-3 p-3 bg-gray-50 rounded-md">
                  <p className="font-medium text-gray-900 mb-1">
                    {selectedRecord.description}
                  </p>
                  <p className="text-sm text-gray-600">
                    {selectedRecord.unitsAffected} units will be reverted
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Applied: {format(new Date(selectedRecord.appliedAt), "MMM d, yyyy 'at' h:mm a")}
                  </p>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-revert">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmRevert}
              disabled={revertMutation.isPending}
              className="bg-[var(--trilogy-teal)] hover:bg-teal-700 text-white"
              data-testid="button-confirm-revert"
            >
              {revertMutation.isPending ? "Reverting..." : "Confirm Revert"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
