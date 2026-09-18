import { useState } from 'react';
import { Search, Filter, X, Calendar, TrendingUp, Clock, SortAsc } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { reciters } from '@/data/reciters';
import { surahs } from '@/data/surahs';
import { motion, AnimatePresence } from 'framer-motion';

export interface SearchFilters {
  query: string;
  reciterId: string;
  surahNumber: string;
  dateFilter: 'all' | 'today' | 'week' | 'month' | 'year';
  sortBy: 'latest' | 'popular' | 'oldest';
}

export const defaultFilters: SearchFilters = {
  query: '',
  reciterId: 'all',
  surahNumber: 'all',
  dateFilter: 'all',
  sortBy: 'latest',
};

interface AdvancedSearchBarProps {
  filters: SearchFilters;
  onFiltersChange: (filters: SearchFilters) => void;
  showReciterFilter?: boolean;
  showSurahFilter?: boolean;
  showDateFilter?: boolean;
  showSortFilter?: boolean;
  placeholder?: string;
}

export function AdvancedSearchBar({
  filters,
  onFiltersChange,
  showReciterFilter = true,
  showSurahFilter = true,
  showDateFilter = true,
  showSortFilter = true,
  placeholder = 'ابحث...',
}: AdvancedSearchBarProps) {
  const [isOpen, setIsOpen] = useState(false);

  const activeFiltersCount = [
    filters.reciterId !== 'all',
    filters.surahNumber !== 'all',
    filters.dateFilter !== 'all',
  ].filter(Boolean).length;

  const updateFilter = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const resetFilters = () => {
    onFiltersChange(defaultFilters);
  };

  const dateFilterOptions = [
    { value: 'all', label: 'كل الأوقات' },
    { value: 'today', label: 'اليوم' },
    { value: 'week', label: 'هذا الأسبوع' },
    { value: 'month', label: 'هذا الشهر' },
    { value: 'year', label: 'هذا العام' },
  ];

  const sortOptions = [
    { value: 'latest', label: 'الأحدث', icon: Clock },
    { value: 'popular', label: 'الأكثر شعبية', icon: TrendingUp },
    { value: 'oldest', label: 'الأقدم', icon: SortAsc },
  ];

  return (
    <div className="space-y-3">
      {/* Main Search Bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input
            placeholder={placeholder}
            aria-label={placeholder}
            value={filters.query}
            onChange={(e) => updateFilter('query', e.target.value)}
            className="pr-10"
          />
          {filters.query && (
            <button
              onClick={() => updateFilter('query', '')}
              aria-label="مسح نص البحث"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
        
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="icon" aria-label="تصفية النتائج" className="relative shrink-0">
              <Filter className="h-4 w-4" aria-hidden="true" />
              {activeFiltersCount > 0 && (
                <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center">
                  {activeFiltersCount}
                </span>
              )}
            </Button>
          </CollapsibleTrigger>
        </Collapsible>
      </div>

      {/* Sort Buttons (always visible) */}
      {showSortFilter && (
        <div className="flex gap-2 flex-wrap">
          {sortOptions.map((option) => {
            const Icon = option.icon;
            return (
              <Button
                key={option.value}
                size="sm"
                variant={filters.sortBy === option.value ? 'default' : 'outline'}
                onClick={() => updateFilter('sortBy', option.value as SearchFilters['sortBy'])}
                className="gap-1.5"
              >
                <Icon className="h-3.5 w-3.5" />
                {option.label}
              </Button>
            );
          })}
        </div>
      )}

      {/* Expandable Filters */}
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleContent>
          <AnimatePresence>
            {isOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="p-4 bg-muted/50 rounded-lg space-y-4 border border-border">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium flex items-center gap-2">
                      <Filter className="h-4 w-4" />
                      فلاتر متقدمة
                    </h4>
                    {activeFiltersCount > 0 && (
                      <Button variant="ghost" size="sm" onClick={resetFilters} className="text-xs h-7">
                        إعادة تعيين
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {/* Reciter Filter */}
                    {showReciterFilter && (
                      <div className="space-y-1.5">
                        <label className="text-xs text-muted-foreground">القارئ</label>
                        <Select
                          value={filters.reciterId}
                          onValueChange={(v) => updateFilter('reciterId', v)}
                        >
                          <SelectTrigger className="h-9 text-sm">
                            <SelectValue placeholder="كل القراء" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">كل القراء</SelectItem>
                            {reciters.map((r) => (
                              <SelectItem key={r.id} value={r.id}>
                                {r.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* Surah Filter */}
                    {showSurahFilter && (
                      <div className="space-y-1.5">
                        <label className="text-xs text-muted-foreground">السورة</label>
                        <Select
                          value={filters.surahNumber}
                          onValueChange={(v) => updateFilter('surahNumber', v)}
                        >
                          <SelectTrigger className="h-9 text-sm">
                            <SelectValue placeholder="كل السور" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">كل السور</SelectItem>
                            {surahs.map((s) => (
                              <SelectItem key={s.number} value={String(s.number)}>
                                {s.number}. {s.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* Date Filter */}
                    {showDateFilter && (
                      <div className="space-y-1.5">
                        <label className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          التاريخ
                        </label>
                        <Select
                          value={filters.dateFilter}
                          onValueChange={(v) => updateFilter('dateFilter', v as SearchFilters['dateFilter'])}
                        >
                          <SelectTrigger className="h-9 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {dateFilterOptions.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>

                  {/* Active Filters Tags */}
                  {activeFiltersCount > 0 && (
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                      {filters.reciterId !== 'all' && (
                        <Badge variant="secondary" className="gap-1 text-xs">
                          {reciters.find(r => r.id === filters.reciterId)?.name}
                          <button onClick={() => updateFilter('reciterId', 'all')}>
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      )}
                      {filters.surahNumber !== 'all' && (
                        <Badge variant="secondary" className="gap-1 text-xs">
                          {surahs.find(s => String(s.number) === filters.surahNumber)?.name}
                          <button onClick={() => updateFilter('surahNumber', 'all')}>
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      )}
                      {filters.dateFilter !== 'all' && (
                        <Badge variant="secondary" className="gap-1 text-xs">
                          {dateFilterOptions.find(d => d.value === filters.dateFilter)?.label}
                          <button onClick={() => updateFilter('dateFilter', 'all')}>
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// Helper function to get date filter timestamp
export function getDateFilterTimestamp(dateFilter: SearchFilters['dateFilter']): string | null {
  const now = new Date();
  switch (dateFilter) {
    case 'today':
      now.setHours(0, 0, 0, 0);
      return now.toISOString();
    case 'week':
      now.setDate(now.getDate() - 7);
      return now.toISOString();
    case 'month':
      now.setMonth(now.getMonth() - 1);
      return now.toISOString();
    case 'year':
      now.setFullYear(now.getFullYear() - 1);
      return now.toISOString();
    default:
      return null;
  }
}
