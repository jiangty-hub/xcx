'use strict'
const db = uniCloud.database()

module.exports = {
	/**
	 * 获取左侧一级分类（category表）
	 * 返回字段：cate_id, name, icon, sort
	 */
	async getCategories() {
		const res = await db.collection('category')
			.where({ level: 0, deleted: false })
			.orderBy('sort', 'asc')
			.field({ cate_id: true, name: true, icon: true, sort: true, level: true, pid: true })
			.get()

		return res.data || []
	},

	/**
	 * 获取右侧菜品列表（foods表），按 categoryId 过滤
	 * 返回字段：name, cover_images, categoryId（列表页够用）
	 */
	async getFoodsByCategory(categoryId) {
		if (categoryId === undefined || categoryId === null) {
			throw new Error('categoryId 不能为空')
		}

		const res = await db.collection('foods')
			.where({ categoryId })
			.field({ name: true, cover_images: true, categoryId: true, foodId: true })
			.get()

		return res.data || []
	},

	/**
	 * 菜品详情：按 foods._id 查询一条
	 */
	async getFoodDetail(id) {
		if (!id) throw new Error('id 不能为空')

		const res = await db.collection('foods').doc(id).get()
		const data = res.data && res.data[0]
		if (!data) throw new Error('菜品不存在')
		return data
	},
	
	/**
	 * 搜索菜品（按名称模糊匹配）
	 */
	async searchFoods(keyword) {
	  if (!keyword || !keyword.trim()) return []
	
	  const reg = new RegExp(keyword.trim(), 'i')
	
	  const res = await db.collection('foods')
	    .where({
	      name: reg
	    })
	    .field({ name: true, cover_images: true, categoryId: true })
	    .limit(50)
	    .get()
	
	  return res.data || []
	}
}
