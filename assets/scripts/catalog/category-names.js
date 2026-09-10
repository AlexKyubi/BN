const LEGACY_CATEGORY_NAMES = new Map([
    ["tv", "Телевизоры"],
    ["refrigerators", "Холодильники"],
    ["washing machines", "Стиральные машины"],
    ["air conditioners", "Кондиционеры"],
    ["water heaters", "Водонагреватели"],
    ["bi oven", "Духовые шкафы"],
    ["bi microwave ovens", "СВЧ-печи"],
    ["built-in cooktops", "Встраиваемые варочные панели"],
    ["bi hoods", "Вытяжки"],
    ["dishwashers", "Посудомойки"],
    ["compact dishwashers", "Посудомойки"],
    ["freezers", "Морозильные камеры"],
    ["laptops", "Ноутбуки"],
    ["vacuum cleaners", "Пылесосы"],
    ["blenders", "Блендеры"],
]);

export function normalizeCatalogCategory(value) {
    const category = String(value || "").trim() || "Без категории";
    return LEGACY_CATEGORY_NAMES.get(category.toLocaleLowerCase("en-US")) || category;
}
