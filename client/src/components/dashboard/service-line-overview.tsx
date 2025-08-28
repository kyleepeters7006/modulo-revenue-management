import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Users, Filter } from "lucide-react";
import { serviceLineEnum } from "@shared/schema";

interface ServiceLineOverviewProps {
  onServiceLineChange?: (serviceLine: string) => void;
}

const serviceLineNames = {
  'AL': 'Assisted Living',
  'AL/MC': 'Assisted Living/Memory Care',
  'HC': 'Health Center',
  'HC/MC': 'Health Center/Memory Care',
  'IL': 'Independent Living',
  'SL': 'Senior Living'
};

export default function ServiceLineOverview({ onServiceLineChange }: ServiceLineOverviewProps) {
  const [selectedServiceLine, setSelectedServiceLine] = useState<string>("All");

  const { data: overview, isLoading } = useQuery({
    queryKey: ["/api/overview", selectedServiceLine],
    queryFn: () => {
      const params = selectedServiceLine !== "All" ? `?serviceLine=${selectedServiceLine}` : "";
      return fetch(`/api/overview${params}`).then(res => res.json());
    }
  });

  const handleServiceLineChange = (value: string) => {
    setSelectedServiceLine(value);
    onServiceLineChange?.(value);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-10 bg-[var(--dashboard-surface)] rounded animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-32 bg-[var(--dashboard-surface)] rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Service Line Filter */}
      <Card className="bg-[var(--dashboard-surface)] border-[var(--dashboard-border)]">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold text-[var(--dashboard-text)] flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Service Line Filter
            </CardTitle>
            <Select value={selectedServiceLine} onValueChange={handleServiceLineChange}>
              <SelectTrigger className="w-64" data-testid="select-service-line">
                <SelectValue placeholder="Select service line" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Service Lines</SelectItem>
                {serviceLineEnum.map((line) => (
                  <SelectItem key={line} value={line}>
                    {serviceLineNames[line]} ({line})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
      </Card>

      {/* Service Line Occupancy Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {overview?.occupancyByServiceLine?.map((serviceLine: any) => (
          <Card 
            key={serviceLine.serviceLine} 
            className={`bg-[var(--dashboard-surface)] border-[var(--dashboard-border)] transition-all duration-200 ${
              selectedServiceLine === serviceLine.serviceLine 
                ? 'ring-2 ring-[var(--trilogy-blue)] shadow-lg' 
                : 'hover:shadow-md'
            }`}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-[var(--dashboard-text)]">
                {serviceLineNames[serviceLine.serviceLine as keyof typeof serviceLineNames]}
              </CardTitle>
              <Building2 className="h-4 w-4 text-[var(--dashboard-muted)]" />
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-xs">
                    {serviceLine.serviceLine}
                  </Badge>
                  <span className="text-lg font-semibold text-[var(--dashboard-text)]">
                    {serviceLine.occupancyRate}%
                  </span>
                </div>
                <Progress 
                  value={serviceLine.occupancyRate} 
                  className="h-2"
                />
                <div className="flex items-center justify-between text-xs text-[var(--dashboard-muted)]">
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {serviceLine.occupied} occupied
                  </span>
                  <span>{serviceLine.total} total units</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filtered Room Type Overview */}
      {selectedServiceLine !== "All" && (
        <Card className="bg-[var(--dashboard-surface)] border-[var(--dashboard-border)]">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-[var(--dashboard-text)]">
              Room Types - {serviceLineNames[selectedServiceLine as keyof typeof serviceLineNames]}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {overview?.occupancyByRoomType?.map((roomType: any) => (
                <div key={roomType.roomType} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-[var(--dashboard-text)]">
                      {roomType.roomType}
                    </span>
                    <span className="text-sm font-semibold text-[var(--dashboard-text)]">
                      {roomType.occupancyRate}%
                    </span>
                  </div>
                  <Progress value={roomType.occupancyRate} className="h-2" />
                  <div className="flex items-center justify-between text-xs text-[var(--dashboard-muted)]">
                    <span>{roomType.occupied} occupied</span>
                    <span>{roomType.total} total</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}