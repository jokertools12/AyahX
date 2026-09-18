import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Layout } from '@/components/Layout';
import { SurahCard } from '@/components/SurahCard';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { surahs } from '@/data/surahs';
import { Search, Filter } from 'lucide-react';
import { normalizeArabicText } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type FilterType = 'all' | 'Meccan' | 'Medinan';
type SortType = 'number' | 'name' | 'ayahs';

export default function SurahsPage() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [sortBy, setSortBy] = useState<SortType>('number');

  const filteredSurahs = useMemo(() => {
    const normQuery = normalizeArabicText(searchQuery);
    let result = surahs.filter((surah) => {
      const matchesSearch =
        !normQuery ||
        normalizeArabicText(surah.name).includes(normQuery) ||
        surah.englishName.toLowerCase().includes(normQuery) ||
        surah.number.toString().includes(searchQuery.trim());

      const matchesFilter = filter === 'all' || surah.revelationType === filter;

      return matchesSearch && matchesFilter;
    });

    // Sorting
    if (sortBy === 'name') {
      result = [...result].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    } else if (sortBy === 'ayahs') {
      result = [...result].sort((a, b) => b.numberOfAyahs - a.numberOfAyahs);
    }
    // 'number' is default order

    return result;
  }, [searchQuery, filter, sortBy]);

  const handleSurahClick = (surahNumber: number) => {
    navigate(`/create?surah=${surahNumber}`);
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h1 className="text-3xl md:text-4xl font-bold mb-2">سور القرآن الكريم</h1>
          <p className="text-muted-foreground">
            اختر سورة لإنشاء مقطع فيديو منها
          </p>
        </motion.div>

        {/* Search and Filter */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex flex-col sm:flex-row gap-4 mb-8"
        >
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input
              placeholder="ابحث بالاسم أو الرقم..."
              aria-label="البحث عن سورة بالاسم أو الرقم"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pr-10"
            />
          </div>

          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortType)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="ترتيب حسب" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="number">رقم السورة</SelectItem>
              <SelectItem value="name">الاسم</SelectItem>
              <SelectItem value="ayahs">عدد الآيات</SelectItem>
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Filter className="h-4 w-4" />
                <span>
                  {filter === 'all'
                    ? 'جميع السور'
                    : filter === 'Meccan'
                    ? 'مكية'
                    : 'مدنية'}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setFilter('all')}>
                جميع السور
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setFilter('Meccan')}>
                السور المكية
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setFilter('Medinan')}>
                السور المدنية
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </motion.div>

        {/* Results Count */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-sm text-muted-foreground mb-6"
        >
          عرض {filteredSurahs.length} من {surahs.length} سورة
        </motion.p>

        {/* Surahs Grid */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
        >
          {filteredSurahs.map((surah) => (
            <SurahCard
              key={surah.number}
              number={surah.number}
              name={surah.name}
              englishName={surah.englishName}
              revelationType={surah.revelationType}
              numberOfAyahs={surah.numberOfAyahs}
              onClick={() => handleSurahClick(surah.number)}
            />
          ))}
        </motion.div>

        {/* Empty State */}
        {filteredSurahs.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-12"
          >
            <p className="text-muted-foreground text-lg">
              لم يتم العثور على نتائج للبحث "{searchQuery}"
            </p>
          </motion.div>
        )}
      </div>
    </Layout>
  );
}
