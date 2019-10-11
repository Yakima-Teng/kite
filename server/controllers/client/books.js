const models = require('../../../db/mysqldb/index')
const moment = require('moment')
const { resClientJson } = require('../../utils/resData')
const Op = require('sequelize').Op
const cheerio = require('cheerio')
const clientWhere = require('../../utils/clientWhere')
const xss = require('xss')
const config = require('../../config')
const { lowdb } = require('../../../db/lowdb/index')
const { TimeNow, TimeDistance } = require('../../utils/time')

function ErrorMessage (message) {
  this.message = message
  this.name = 'UserException'
}

function getNoMarkupStr (markupStr) {
  /* markupStr 源码</> */
  // console.log(markupStr);
  let noMarkupStr = markupStr
  /* 得到可视文本(不含图片),将&nbsp;&lt;&gt;转为空字符串和<和>显示,同时去掉了换行,文本单行显示 */
  // console.log("1--S" + noMarkupStr + "E--");
  noMarkupStr = noMarkupStr.replace(/(\r\n|\n|\r)/gm, '')
  /* 去掉可视文本中的换行,(没有用,上一步已经自动处理) */
  // console.log("2--S" + noMarkupStr + "E--");
  noMarkupStr = noMarkupStr.replace(/^\s+/g, '')
  /* 替换开始位置一个或多个空格为一个空字符串 */
  // console.log("3--S" + noMarkupStr + "E--");
  noMarkupStr = noMarkupStr.replace(/\s+$/g, '')
  /* 替换结束位置一个或多个空格为一个空字符串 */
  // console.log("4--S" + noMarkupStr + "E--");
  noMarkupStr = noMarkupStr.replace(/\s+/g, ' ')
  /* 替换中间位置一个或多个空格为一个空格 */
  // console.log("5--S" + noMarkupStr + "E--");
  return noMarkupStr
}

function getSubStr (string) {
  let str = ''
  let len = 0
  for (var i = 0; i < string.length; i++) {
    if (string[i].match(/[^\x00-\xff]/gi) != null) {
      len += 2
    } else {
      len += 1
    }
    if (len > 240) {
      /* 240为要截取的长度 */
      str += '...'
      break
    }
    str += string[i]
  }
  return str
}

class Books {
  /**
   * 新建小书post提交
   * @param   {object} ctx 上下文对象
   */
  static async createBooks (ctx) {
    let reqData = ctx.request.body
    let { user = '' } = ctx.request
    try {
      if (!reqData.title) {
        throw new ErrorMessage('请输入小书名字')
      }

      if (reqData.title.length > 150) {
        throw new ErrorMessage('小书标题过长，请小于150个字符')
      }

      if (!reqData.description) {
        throw new ErrorMessage('请输入小书简介')
      }

      if (!reqData.content) {
        throw new ErrorMessage('请输入小书详情')
      }

      if (!reqData.tag_ids) {
        throw new ErrorMessage('请选择小书标签')
      }

      let date = new Date()
      let currDate = moment(date.setHours(date.getHours())).format(
        'YYYY-MM-DD HH:mm:ss'
      )

      if (new Date(currDate).getTime() < new Date(user.ban_dt).getTime()) {
        throw new ErrorMessage(
          `当前用户因违规已被管理员禁用发布系统，时间到：${moment(
            user.ban_dt
          ).format('YYYY年MM月DD日 HH时mm分ss秒')},如有疑问请联系网站管理员`
        )
      }

      let oneArticleTag = await models.article_tag.findOne({
        where: {
          article_tag_id: config.ARTICLE_TAG.dfOfficialExclusive
        }
      })
      const website = lowdb
        .read()
        .get('website')
        .value()
      if (~reqData.tag_ids.indexOf(config.ARTICLE_TAG.dfOfficialExclusive)) {
        if (!~user.user_role_ids.indexOf(config.USER_ROLE.dfManagementTeam)) {
          throw new ErrorMessage(
            `${oneArticleTag.article_tag_name}只有${website.website_name}管理团队才能发布小书`
          )
        }
      }

      const result = reqData.origin_content.match(/!\[(.*?)\]\((.*?)\)/)
      let $ = cheerio.load(reqData.content)

      let userRoleALL = await models.user_role.findAll({
        where: {
          user_role_id: {
            [Op.or]: user.user_role_ids.split(',')
          },
          user_role_type: 1 // 用户角色类型1是默认角色
        }
      })

      let userAuthorityIds = ''
      userRoleALL.map(roleItem => {
        userAuthorityIds += roleItem.user_authority_ids + ','
      })

      let status = ~userAuthorityIds.indexOf(config.BOOKS.dfNoReviewBooksId)
        ? 4
        : 1

      await models.books.create({
        uid: user.uid,
        title: xss(reqData.title),
        description: xss(reqData.description),
        content: xss(reqData.content) /* 主内容 */,
        cover_img: reqData.cover_img || config.DF_ICON /* 封面  */,
        origin_content: reqData.origin_content /* 源内容 */,
        status, // '1:审核中;2:审核通过;3:审核失败;4：无需审核'
        is_public: Number(reqData.is_public), // 是否公开
        tag_ids: reqData.tag_ids
      })

      resClientJson(ctx, {
        state: 'success',
        message: '创建成功'
      })
    } catch (err) {
      resClientJson(ctx, {
        state: 'error',
        message: '错误信息：' + err.message
      })
      return false
    }
  }

  /**
   * ajax 查询一篇用户自己的小书
   * @param   {object} ctx 上下文对象
   */
  static async getUserBooksInfo (ctx) {
    let { books_id } = ctx.query
    let { user = '' } = ctx.request
    try {
      let books = await models.books.findOne({
        where: {
          uid: user.uid,
          books_id
        }
      })

      if (books) {
        if (books) {
          resClientJson(ctx, {
            state: 'success',
            message: '获取小书成功',
            data: { books }
          })
        } else {
          resClientJson(ctx, {
            state: 'error',
            message: '获取小书失败'
          })
        }
      } else {
        throw new ErrorMessage('获取小书失败')
      }
    } catch (err) {
      resClientJson(ctx, {
        state: 'error',
        message: '错误信息：' + err.message
      })
      return false
    }
  }

  /**
   * 更新小书
   * @param   {object} ctx 上下文对象
   */
  static async updateBooks (ctx) {
    let reqData = ctx.request.body
    let { user = '' } = ctx.request
    try {
      if (!reqData.title) {
        throw new ErrorMessage('请输入小书名字')
      }

      if (reqData.title.length > 150) {
        throw new ErrorMessage('小书标题过长，请小于150个字符')
      }

      if (!reqData.description) {
        throw new ErrorMessage('请输入小书简介')
      }

      if (!reqData.content) {
        throw new ErrorMessage('请输入小书详情')
      }

      if (!reqData.tag_ids) {
        throw new ErrorMessage('请选择小书标签')
      }

      let date = new Date()
      let currDate = moment(date.setHours(date.getHours())).format(
        'YYYY-MM-DD HH:mm:ss'
      )

      if (new Date(currDate).getTime() < new Date(user.ban_dt).getTime()) {
        throw new ErrorMessage(
          `当前用户因违规已被管理员禁用发布系统，时间到：${moment(
            user.ban_dt
          ).format('YYYY年MM月DD日 HH时mm分ss秒')},如有疑问请联系网站管理员`
        )
      }

      let oneArticleTag = await models.article_tag.findOne({
        where: {
          article_tag_id: config.ARTICLE_TAG.dfOfficialExclusive
        }
      })
      const website = lowdb
        .read()
        .get('website')
        .value()
      if (~reqData.tag_ids.indexOf(config.ARTICLE_TAG.dfOfficialExclusive)) {
        if (!~user.user_role_ids.indexOf(config.USER_ROLE.dfManagementTeam)) {
          throw new ErrorMessage(
            `${oneArticleTag.article_tag_name}只有${website.website_name}管理团队才能发布小书`
          )
        }
      }

      let userRoleALL = await models.user_role.findAll({
        where: {
          user_role_id: {
            [Op.or]: user.user_role_ids.split(',')
          },
          user_role_type: 1 // 用户角色类型1是默认角色
        }
      })

      let userAuthorityIds = ''
      userRoleALL.map(roleItem => {
        userAuthorityIds += roleItem.user_authority_ids + ','
      })

      let status = ~userAuthorityIds.indexOf(config.BOOKS.dfNoReviewBooksId)
        ? 4
        : 1

      await models.books.update(
        {
          title: xss(reqData.title),
          description: xss(reqData.description),
          content: xss(reqData.content) /* 主内容 */,
          cover_img: reqData.cover_img || config.DF_ICON /* 封面  */,
          origin_content: reqData.origin_content /* 源内容 */,
          status, // '1:审核中;2:审核通过;3:审核失败;4：无需审核'
          is_public: Number(reqData.is_public), // 是否公开
          tag_ids: reqData.tag_ids
        },
        {
          where: {
            books_id: reqData.books_id, // 查询条件
            uid: user.uid
          }
        }
      )

      resClientJson(ctx, {
        state: 'success',
        message: '修改小书成功'
      })
    } catch (err) {
      resClientJson(ctx, {
        state: 'error',
        message: '错误信息：' + err.message
      })
      return false
    }
  }

  /**
   * 删除一本小书
   * @param   {object} ctx 上下文对象
   */

  static async deleteBooks (ctx) {
    const resData = ctx.request.body
    let { user = '' } = ctx.request
    try {
      await models.books.destroy({
        where: {
          books_id: resData.books_id, // 查询条件
          uid: user.uid
        }
      })
      resClientJson(ctx, {
        state: 'success',
        message: '删除小书成功'
      })
    } catch (err) {
      resClientJson(ctx, {
        state: 'error',
        message: '错误信息：' + err.message
      })
      return false
    }
  }

  // 首页的公开的小书列表

  static async getBooksList (ctx) {
    let page = ctx.query.page || 1
    let pageSize = ctx.query.pageSize || 24
    let sort = ctx.query.sort
    let tagId = ctx.query.tagId
    let columnEnName = ctx.query.columnEnName
    let tagIdArr = []
    let whereParams = {
      is_public: true,
      status: {
        [Op.or]: [2, 4]
      }
    }

    let orderParams = []

    let allArticleTagId = [] // 全部禁止某些文章标签推送的id
    let allArticleTag = await models.article_tag.findAll({
      where: {
        is_push: false
      } // 为空，获取全部，也可以自己添加条件
    })

    if (allArticleTag && allArticleTag.length > 0) {
      for (let item in allArticleTag) {
        allArticleTagId.push(allArticleTag[item].article_tag_id)
      }

      console.log('allArticleTag', allArticleTagId)
      whereParams['tag_ids'] = {
        [Op.notRegexp]: `${allArticleTagId.join('|')}`
      }
    }

    if (columnEnName && columnEnName !== 'all') {
      if (!tagId) {
        let oneArticleColumn = await models.article_column.findOne({
          where: {
            article_column_en_name: columnEnName
          } // 为空，获取全部，也可以自己添加条件
        })
        tagIdArr = oneArticleColumn.article_tag_ids.split(',')
      } else {
        tagIdArr = [tagId]
      }
    }

    !sort && (orderParams = [['create_date', 'DESC']])
    sort === 'hot' && (orderParams = [['like_count', 'DESC']])

    tagIdArr.length > 0 &&
      (whereParams['tag_ids'] = {
        [Op.regexp]: `${tagIdArr.join('|')}`
      })

    sort === '7day' &&
      (whereParams['create_date'] = {
        [Op.between]: [
          new Date(TimeNow.showWeekFirstDay()),
          new Date(TimeNow.showWeekLastDay())
        ]
      })

    sort === '30day' &&
      (whereParams['create_date'] = {
        [Op.between]: [
          new Date(TimeNow.showMonthFirstDay()),
          new Date(TimeNow.showMonthLastDay())
        ]
      })

    try {
      let { count, rows } = await models.books.findAndCountAll({
        where: whereParams, // 为空，获取全部，也可以自己添加条件
        offset: (page - 1) * pageSize, // 开始的数据索引，比如当page=2 时offset=10 ，而pagesize我们定义为10，则现在为索引为10，也就是从第11条开始返回数据条目
        limit: pageSize, // 每页限制返回的数据条数
        order: orderParams
      })

      for (let i in rows) {
        rows[i].setDataValue(
          'create_dt',
          await TimeDistance(rows[i].create_date)
        )
        rows[i].setDataValue('update_dt', await TimeDistance(rows[i].update_dt))

        rows[i].setDataValue(
          'bookCount',
          await models.book.count({
            where: { books_id: rows[i].books_id }
          })
        )

        if (rows[i].tag_ids) {
          rows[i].setDataValue(
            'tag',
            await models.article_tag.findAll({
              where: { article_tag_id: { [Op.or]: rows[i].tag_ids.split(',') } }
            })
          )
        }

        rows[i].setDataValue(
          'user',
          await models.user.findOne({
            where: { uid: rows[i].uid },
            attributes: ['uid', 'avatar', 'nickname', 'sex', 'introduction']
          })
        )
      }

      await resClientJson(ctx, {
        state: 'success',
        message: 'success',
        data: {
          page,
          count,
          pageSize,
          list: rows
        }
      })
    } catch (err) {
      resClientJson(ctx, {
        state: 'error',
        message: '错误信息：' + err.message
      })
      return false
    }
  }

  /**
   * ajax 查询一篇小书信息
   * @param   {object} ctx 上下文对象
   */
  static async getBooksInfo (ctx) {
    let { books_id } = ctx.query
    try {
      let books = await models.books.findOne({
        where: {
          books_id
        }
      })

      if (books) {
        await models.books.update(
          { read_count: Number(books.read_count) + 1 },
          { where: { books_id } } // 为空，获取全部，也可以自己添加条件
        )

        books.setDataValue('create_dt', await TimeDistance(books.create_date))

        books.setDataValue(
          'bookCount',
          await models.book.count({ where: { books_id } })
        )

        books.setDataValue(
          'user',
          await models.user.findOne({
            where: { uid: books.uid },
            attributes: ['uid', 'avatar', 'nickname', 'sex', 'introduction']
          })
        )

        if (books) {
          resClientJson(ctx, {
            state: 'success',
            message: '获取小书成功',
            data: { books }
          })
        } else {
          resClientJson(ctx, {
            state: 'error',
            message: '获取小书失败'
          })
        }
      } else {
        throw new ErrorMessage('获取小书失败')
      }
    } catch (err) {
      resClientJson(ctx, {
        state: 'error',
        message: '错误信息：' + err.message
      })
      return false
    }
  }

  /**
   * ajax 查询一篇小书所有的章节
   * @param   {object} ctx 上下文对象
   */
  static async getBooksBookAll (ctx) {
    let { books_id } = ctx.query
    try {
      let books = await models.books.findOne({
        where: {
          books_id
        }
      })

      if (books) {
        let allBook = await models.book.findAll({
          where: {
            books_id
          }
        })

        for (let i in allBook) {
          allBook[i].setDataValue(
            'commentCount',
            await models.book_comment.count({
              where: { book_id: allBook[i].book_id }
            })
          )
        }

        resClientJson(ctx, {
          state: 'success',
          message: '获取小书所有章节成功',
          data: { list: allBook }
        })
      } else {
        resClientJson(ctx, {
          state: 'error',
          message: '获取小书章节失败，小书不存在'
        })
      }
    } catch (err) {
      resClientJson(ctx, {
        state: 'error',
        message: '错误信息：' + err.message
      })
      return false
    }
  }
}

module.exports = Books