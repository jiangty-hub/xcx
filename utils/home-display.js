// 首页只展示已确认的四道拿手菜，不使用旧 navigator_url。
const FEATURED_IDS = ['112', '113', '114', '115']
export function getFeaturedDishes(groups) {
  const records = (Array.isArray(groups) ? groups : []).reduce((all, group) =>
    all.concat(Array.isArray(group) ? group : []), [])
  return FEATURED_IDS.map(id => {
    const item = records.find(row => row && String(row.goods_id) === id)
    if (!item) return null
    return {
      id,
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : '菜品' + id,
      image: typeof item.image_src === 'string' && item.image_src.trim()
        ? item.image_src.trim() : '/static/cover-default.png'
    }
  }).filter(Boolean)
}
