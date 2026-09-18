export interface FamousAyah {
  id: string;
  name: string;
  description: string;
  surahNumber: number;
  startAyah: number;
  endAyah: number;
  category: 'protection' | 'healing' | 'dua' | 'motivation' | 'story' | 'short' | 'paradise' | 'mercy' | 'remembrance';
}

export const famousAyahs: FamousAyah[] = [
  // آيات الحماية والرقية
  { id: 'ayat-kursi', name: 'آية الكرسي', description: 'سورة البقرة - الآية 255', surahNumber: 2, startAyah: 255, endAyah: 255, category: 'protection' },
  { id: 'fatiha', name: 'سورة الفاتحة كاملة', description: 'أم الكتاب', surahNumber: 1, startAyah: 1, endAyah: 7, category: 'protection' },
  { id: 'last-baqarah', name: 'خواتيم البقرة', description: 'آخر آيتين من سورة البقرة', surahNumber: 2, startAyah: 285, endAyah: 286, category: 'protection' },
  { id: 'ikhlas', name: 'سورة الإخلاص', description: 'تعدل ثلث القرآن', surahNumber: 112, startAyah: 1, endAyah: 4, category: 'protection' },
  { id: 'falaq', name: 'سورة الفلق', description: 'المعوذتين - الأولى', surahNumber: 113, startAyah: 1, endAyah: 5, category: 'protection' },
  { id: 'nas', name: 'سورة الناس', description: 'المعوذتين - الثانية', surahNumber: 114, startAyah: 1, endAyah: 6, category: 'protection' },
  { id: 'baqarah-first5', name: 'أوائل البقرة', description: 'أول 5 آيات من البقرة', surahNumber: 2, startAyah: 1, endAyah: 5, category: 'protection' },
  { id: 'hashr-end', name: 'خواتيم الحشر', description: 'آخر 3 آيات من سورة الحشر', surahNumber: 59, startAyah: 22, endAyah: 24, category: 'protection' },

  // آيات الشفاء
  { id: 'shifa-baqara', name: 'آيات الشفاء - البقرة', description: 'وَإِذَا مَرِضْتُ فَهُوَ يَشْفِينِ', surahNumber: 26, startAyah: 80, endAyah: 80, category: 'healing' },
  { id: 'shifa-yunus', name: 'آيات الشفاء - يونس', description: 'يَا أَيُّهَا النَّاسُ قَدْ جَاءَتْكُمْ مَوْعِظَةٌ', surahNumber: 10, startAyah: 57, endAyah: 57, category: 'healing' },
  { id: 'shifa-isra', name: 'آيات الشفاء - الإسراء', description: 'وَنُنَزِّلُ مِنَ الْقُرْآنِ مَا هُوَ شِفَاءٌ', surahNumber: 17, startAyah: 82, endAyah: 82, category: 'healing' },
  { id: 'shifa-fussilat', name: 'آيات الشفاء - فصلت', description: 'قُلْ هُوَ لِلَّذِينَ آمَنُوا هُدًى وَشِفَاءٌ', surahNumber: 41, startAyah: 44, endAyah: 44, category: 'healing' },
  { id: 'shifa-nahl', name: 'آيات الشفاء - النحل', description: 'فِيهِ شِفَاءٌ لِلنَّاسِ', surahNumber: 16, startAyah: 69, endAyah: 69, category: 'healing' },
  { id: 'shifa-tawba', name: 'آيات الشفاء - التوبة', description: 'وَيَشْفِ صُدُورَ قَوْمٍ مُؤْمِنِينَ', surahNumber: 9, startAyah: 14, endAyah: 14, category: 'healing' },

  // آيات الدعاء
  { id: 'dua-rabbanah-1', name: 'ربنا آتنا', description: 'دعاء من سورة البقرة', surahNumber: 2, startAyah: 201, endAyah: 202, category: 'dua' },
  { id: 'dua-rabbanah-2', name: 'ربنا لا تزغ قلوبنا', description: 'دعاء من سورة آل عمران', surahNumber: 3, startAyah: 8, endAyah: 9, category: 'dua' },
  { id: 'dua-ibrahim', name: 'دعاء إبراهيم للوالدين', description: 'رَبِّ اغْفِرْ لِي وَلِوَالِدَيَّ', surahNumber: 14, startAyah: 40, endAyah: 41, category: 'dua' },
  { id: 'dua-musa', name: 'دعاء موسى', description: 'رَبِّ اشْرَحْ لِي صَدْرِي', surahNumber: 20, startAyah: 25, endAyah: 28, category: 'dua' },
  { id: 'dua-furqan', name: 'عباد الرحمن', description: 'رَبَّنَا هَبْ لَنَا مِنْ أَزْوَاجِنَا', surahNumber: 25, startAyah: 74, endAyah: 76, category: 'dua' },
  { id: 'dua-anbiya', name: 'دعاء يونس', description: 'لَا إِلَٰهَ إِلَّا أَنتَ سُبْحَانَكَ', surahNumber: 21, startAyah: 87, endAyah: 88, category: 'dua' },
  { id: 'dua-baqarah-127', name: 'دعاء بناء الكعبة', description: 'رَبَّنَا تَقَبَّلْ مِنَّا', surahNumber: 2, startAyah: 127, endAyah: 128, category: 'dua' },
  { id: 'dua-ali-imran', name: 'ربنا إننا آمنا', description: 'رَبَّنَا إِنَّنَا آمَنَّا فَاغْفِرْ لَنَا', surahNumber: 3, startAyah: 16, endAyah: 17, category: 'dua' },
  { id: 'dua-kahf', name: 'دعاء أصحاب الكهف', description: 'رَبَّنَا آتِنَا مِن لَّدُنكَ رَحْمَةً', surahNumber: 18, startAyah: 10, endAyah: 10, category: 'dua' },
  { id: 'dua-nuh', name: 'دعاء نوح', description: 'رَبِّ اغْفِرْ لِي وَلِوَالِدَيَّ', surahNumber: 71, startAyah: 28, endAyah: 28, category: 'dua' },

  // آيات التحفيز والطمأنينة
  { id: 'duha', name: 'سورة الضحى', description: 'تسلية للنبي ﷺ', surahNumber: 93, startAyah: 1, endAyah: 11, category: 'motivation' },
  { id: 'sharh', name: 'سورة الشرح', description: 'إن مع العسر يسرا', surahNumber: 94, startAyah: 1, endAyah: 8, category: 'motivation' },
  { id: 'yusuf-patience', name: 'صبر جميل - يوسف', description: 'فَصَبْرٌ جَمِيلٌ', surahNumber: 12, startAyah: 18, endAyah: 18, category: 'motivation' },
  { id: 'alam-nashrah', name: 'فإن مع العسر يسرا', description: 'تكرار الوعد الإلهي', surahNumber: 94, startAyah: 5, endAyah: 6, category: 'motivation' },
  { id: 'tawakul', name: 'التوكل على الله', description: 'وَمَن يَتَوَكَّلْ عَلَى اللَّهِ فَهُوَ حَسْبُهُ', surahNumber: 65, startAyah: 3, endAyah: 3, category: 'motivation' },
  { id: 'hasbunallah', name: 'حسبنا الله', description: 'حَسْبُنَا اللَّهُ وَنِعْمَ الْوَكِيلُ', surahNumber: 3, startAyah: 173, endAyah: 174, category: 'motivation' },
  { id: 'sabr-wasalah', name: 'الصبر والصلاة', description: 'وَاسْتَعِينُوا بِالصَّبْرِ وَالصَّلاةِ', surahNumber: 2, startAyah: 153, endAyah: 157, category: 'motivation' },
  { id: 'la-tahzan', name: 'لا تحزن', description: 'لَا تَحْزَنْ إِنَّ اللَّهَ مَعَنَا', surahNumber: 9, startAyah: 40, endAyah: 40, category: 'motivation' },
  { id: 'zumar-53', name: 'لا تقنطوا', description: 'لَا تَقْنَطُوا مِن رَّحْمَةِ اللَّهِ', surahNumber: 39, startAyah: 53, endAyah: 53, category: 'motivation' },
  { id: 'ra3d-28', name: 'ذكر الله', description: 'أَلَا بِذِكْرِ اللَّهِ تَطْمَئِنُّ الْقُلُوبُ', surahNumber: 13, startAyah: 28, endAyah: 28, category: 'motivation' },
  { id: 'baqarah-286', name: 'لا يكلف الله', description: 'لَا يُكَلِّفُ اللَّهُ نَفْسًا إِلَّا وُسْعَهَا', surahNumber: 2, startAyah: 286, endAyah: 286, category: 'motivation' },

  // قصص القرآن
  { id: 'maryam-story', name: 'قصة مريم', description: 'من سورة مريم', surahNumber: 19, startAyah: 16, endAyah: 26, category: 'story' },
  { id: 'musa-birth', name: 'قصة مولد موسى', description: 'من سورة القصص', surahNumber: 28, startAyah: 7, endAyah: 13, category: 'story' },
  { id: 'yusuf-intro', name: 'قصة يوسف - البداية', description: 'أحسن القصص', surahNumber: 12, startAyah: 1, endAyah: 6, category: 'story' },
  { id: 'ashab-kahf', name: 'أصحاب الكهف', description: 'قصة الفتية', surahNumber: 18, startAyah: 9, endAyah: 16, category: 'story' },
  { id: 'ibrahim-fire', name: 'إبراهيم والنار', description: 'قلنا يا نار كوني بردا', surahNumber: 21, startAyah: 68, endAyah: 70, category: 'story' },
  { id: 'yusuf-well', name: 'يوسف في البئر', description: 'وأوحينا إليه', surahNumber: 12, startAyah: 15, endAyah: 18, category: 'story' },
  { id: 'musa-sea', name: 'موسى وشق البحر', description: 'فأوحينا إلى موسى أن اضرب', surahNumber: 26, startAyah: 63, endAyah: 68, category: 'story' },

  // السور القصيرة
  { id: 'mulk-start', name: 'بداية سورة الملك', description: 'المانعة من عذاب القبر', surahNumber: 67, startAyah: 1, endAyah: 5, category: 'short' },
  { id: 'kahf-start', name: 'بداية سورة الكهف', description: 'أول 10 آيات', surahNumber: 18, startAyah: 1, endAyah: 10, category: 'short' },
  { id: 'rahman-start', name: 'بداية سورة الرحمن', description: 'عروس القرآن', surahNumber: 55, startAyah: 1, endAyah: 13, category: 'short' },
  { id: 'yasin-start', name: 'بداية سورة يس', description: 'قلب القرآن', surahNumber: 36, startAyah: 1, endAyah: 12, category: 'short' },
  { id: 'asr', name: 'سورة العصر', description: 'لو تدبرها الناس لكفتهم', surahNumber: 103, startAyah: 1, endAyah: 3, category: 'short' },
  { id: 'kawthar', name: 'سورة الكوثر', description: 'أقصر سورة في القرآن', surahNumber: 108, startAyah: 1, endAyah: 3, category: 'short' },
  { id: 'nasr', name: 'سورة النصر', description: 'إِذَا جَاءَ نَصْرُ اللَّهِ', surahNumber: 110, startAyah: 1, endAyah: 3, category: 'short' },
  { id: 'masad', name: 'سورة المسد', description: 'تَبَّتْ يَدَا أَبِي لَهَبٍ', surahNumber: 111, startAyah: 1, endAyah: 5, category: 'short' },
  { id: 'kafirun', name: 'سورة الكافرون', description: 'قُلْ يَا أَيُّهَا الْكَافِرُونَ', surahNumber: 109, startAyah: 1, endAyah: 6, category: 'short' },
  { id: 'qadr', name: 'سورة القدر', description: 'ليلة القدر خير من ألف شهر', surahNumber: 97, startAyah: 1, endAyah: 5, category: 'short' },
  { id: 'tin', name: 'سورة التين', description: 'وَالتِّينِ وَالزَّيْتُونِ', surahNumber: 95, startAyah: 1, endAyah: 8, category: 'short' },
  { id: 'waqiah-start', name: 'بداية سورة الواقعة', description: 'سورة الغنى', surahNumber: 56, startAyah: 1, endAyah: 14, category: 'short' },
  { id: 'hadid-start', name: 'بداية سورة الحديد', description: 'سَبَّحَ لِلَّهِ', surahNumber: 57, startAyah: 1, endAyah: 6, category: 'short' },
  { id: 'taha-start', name: 'بداية سورة طه', description: 'طه مَا أَنزَلْنَا عَلَيْكَ', surahNumber: 20, startAyah: 1, endAyah: 8, category: 'short' },

  // آيات الجنة
  { id: 'paradise-1', name: 'وصف الجنة - الرحمن', description: 'وَلِمَنْ خَافَ مَقَامَ رَبِّهِ جَنَّتَانِ', surahNumber: 55, startAyah: 46, endAyah: 60, category: 'paradise' },
  { id: 'paradise-2', name: 'وصف الجنة - الواقعة', description: 'السابقون السابقون', surahNumber: 56, startAyah: 10, endAyah: 26, category: 'paradise' },
  { id: 'paradise-3', name: 'وصف الجنة - محمد', description: 'مَّثَلُ الْجَنَّةِ الَّتِي وُعِدَ', surahNumber: 47, startAyah: 15, endAyah: 15, category: 'paradise' },
  { id: 'paradise-4', name: 'جنات عدن', description: 'جَنَّاتُ عَدْنٍ يَدْخُلُونَهَا', surahNumber: 13, startAyah: 23, endAyah: 24, category: 'paradise' },

  // آيات الرحمة
  { id: 'mercy-1', name: 'رحمة الله', description: 'وَرَحْمَتِي وَسِعَتْ كُلَّ شَيْءٍ', surahNumber: 7, startAyah: 156, endAyah: 156, category: 'mercy' },
  { id: 'mercy-2', name: 'قرب الله', description: 'وَإِذَا سَأَلَكَ عِبَادِي عَنِّي فَإِنِّي قَرِيبٌ', surahNumber: 2, startAyah: 186, endAyah: 186, category: 'mercy' },
  { id: 'mercy-3', name: 'عباد الرحمن', description: 'وَعِبَادُ الرَّحْمَٰنِ الَّذِينَ يَمْشُونَ', surahNumber: 25, startAyah: 63, endAyah: 67, category: 'mercy' },
  { id: 'mercy-4', name: 'فبأي آلاء', description: 'فَبِأَيِّ آلَاءِ رَبِّكُمَا تُكَذِّبَانِ', surahNumber: 55, startAyah: 13, endAyah: 16, category: 'mercy' },

  // آيات الذكر والتسبيح
  { id: 'remembrance-1', name: 'فاذكروني', description: 'فَاذْكُرُونِي أَذْكُرْكُمْ', surahNumber: 2, startAyah: 152, endAyah: 152, category: 'remembrance' },
  { id: 'remembrance-2', name: 'التسبيح', description: 'يُسَبِّحُ لِلَّهِ مَا فِي السَّمَاوَاتِ', surahNumber: 62, startAyah: 1, endAyah: 4, category: 'remembrance' },
  { id: 'remembrance-3', name: 'آخر الأعراف', description: 'إِنَّ الَّذِينَ عِندَ رَبِّكَ', surahNumber: 7, startAyah: 206, endAyah: 206, category: 'remembrance' },
  { id: 'remembrance-4', name: 'الأحزاب تسبيح', description: 'يَا أَيُّهَا الَّذِينَ آمَنُوا اذْكُرُوا اللَّهَ', surahNumber: 33, startAyah: 41, endAyah: 43, category: 'remembrance' },
];

export const ayahCategories = [
  { id: 'all', name: 'الكل' },
  { id: 'protection', name: 'الحماية والرقية' },
  { id: 'healing', name: 'الشفاء' },
  { id: 'dua', name: 'الدعاء' },
  { id: 'motivation', name: 'التحفيز' },
  { id: 'story', name: 'القصص' },
  { id: 'short', name: 'السور القصيرة' },
  { id: 'paradise', name: 'الجنة' },
  { id: 'mercy', name: 'الرحمة' },
  { id: 'remembrance', name: 'الذكر' },
] as const;

export function getAyahsByCategory(category: string): FamousAyah[] {
  if (category === 'all') return famousAyahs;
  return famousAyahs.filter((a) => a.category === category);
}
