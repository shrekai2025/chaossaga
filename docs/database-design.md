# ChaosSaga - 数据库设计文档

> 基于 Prisma ORM + PostgreSQL

---

## 一、数据模型概览

```
┌─────────────────────────────────────────────────────────────┐
│                        数据关系图                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Player ─────┬───── PlayerSkill ───── Skill (静态)         │
│      │        │                                             │
│      │        ├───── PlayerEquipment                        │
│      │        │                                             │
│      │        ├───── Inventory ───── Item (静态)            │
│      │        │                                             │
│      │        ├───── PlayerPet ───── Pet (静态)             │
│      │        │                                             │
│      │        ├───── PlayerArea ───── Area (静态)           │
│      │        │                                             │
│      │        ├───── Collection                             │
│      │        │                                             │
│      │        └───── BattleLog                              │
│      │                                                      │
│      └─────── RealmDocument (境界文档)                      │
│      └─────── AreaDocument (区域文档)                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、核心数据表

### 2.1 玩家表 (Player)

存储玩家基础信息和状态

| 字段          | 类型          | 说明                            |
| ------------- | ------------- | ------------------------------- |
| id            | String (cuid) | 主键                            |
| name          | String        | 角色名称                        |
| race          | String        | 种族 (默认: human)              |
| background    | String        | 背景故事                        |
| **境界相关**  |               |                                 |
| realm         | String        | 当前境界 (ocean/land/barren...) |
| realmProgress | Int           | 境界进度 (0-100)                |
| level         | Int           | 等级 (1-100)                    |
| exp           | BigInt        | 当前经验值                      |
| **属性值**    |               |                                 |
| maxHp         | Int           | 最大生命值                      |
| currentHp     | Int           | 当前生命值                      |
| maxMp         | Int           | 最大魔法值                      |
| currentMp     | Int           | 当前魔法值                      |
| attack        | Int           | 攻击力                          |
| defense       | Int           | 防御力                          |
| speed         | Int           | 速度                            |
| critRate      | Float         | 暴击率                          |
| critDamage    | Float         | 暴击伤害                        |
| **经济**      |               |                                 |
| gold          | BigInt        | 金币                            |
| spiritStone   | Int           | 灵石                            |
| **环境状态**  |               |                                 |
| location      | String        | 当前位置                        |
| weather       | String        | 天气                            |
| timeOfDay     | String        | 时间                            |
| season        | String        | 季节                            |
| currentAreaId | String?       | 当前区域ID                      |
| **时间戳**    |               |                                 |
| createdAt     | DateTime      | 创建时间                        |
| lastActiveAt  | DateTime      | 最后活跃时间                    |

---

### 2.2 技能表 (Skill) - 静态配置

存储技能模板数据

| 字段           | 类型    | 说明                             |
| -------------- | ------- | -------------------------------- |
| id             | String  | 技能ID                           |
| name           | String  | 技能名称                         |
| type           | Enum    | active/field/passive             |
| element        | Enum    | water/fire/earth/wind/dark/light |
| mpCost         | Int     | MP消耗                           |
| cooldown       | Int     | 冷却回合                         |
| damageRatio    | Float   | 伤害倍率                         |
| targetType     | Enum    | single/aoe/self                  |
| effectType     | String? | 附加效果类型                     |
| effectValue    | Int?    | 效果数值                         |
| effectDuration | Int?    | 效果持续回合                     |
| description    | String  | 技能描述                         |
| unlockRealm    | String? | 解锁境界要求                     |

### 2.3 玩家技能表 (PlayerSkill)

玩家已学习的技能

| 字段        | 类型    | 说明             |
| ----------- | ------- | ---------------- |
| id          | String  | 主键             |
| playerId    | String  | 玩家ID (FK)      |
| skillId     | String  | 技能ID (FK)      |
| level       | Int     | 技能等级         |
| proficiency | Int     | 熟练度           |
| isEquipped  | Boolean | 是否装备到技能栏 |
| slotIndex   | Int?    | 技能栏位置 (0-5) |

---

### 2.4 物品表 (Item) - 静态配置

存储物品模板数据

| 字段              | 类型    | 说明                                                 |
| ----------------- | ------- | ---------------------------------------------------- |
| id                | String  | 物品ID                                               |
| name              | String  | 物品名称                                             |
| type              | Enum    | weapon/armor/accessory/consumable/material/skillbook |
| subType           | String? | 子类型 (头/身/手/脚)                                 |
| quality           | Enum    | common/uncommon/rare/epic/legendary/mythic           |
| **基础属性**      |         |                                                      |
| hp                | Int     | HP加成                                               |
| mp                | Int     | MP加成                                               |
| attack            | Int     | 攻击加成                                             |
| defense           | Int     | 防御加成                                             |
| speed             | Int     | 速度加成                                             |
| **特殊属性**      |         |                                                      |
| setId             | String? | 套装ID                                               |
| effectDescription | String? | 特效描述                                             |
| realmRequirement  | String? | 境界要求                                             |
| description       | String  | 物品描述                                             |

### 2.5 玩家背包表 (Inventory)

玩家持有的物品

| 字段         | 类型    | 说明        |
| ------------ | ------- | ----------- |
| id           | String  | 主键        |
| playerId     | String  | 玩家ID (FK) |
| itemId       | String  | 物品ID (FK) |
| quantity     | Int     | 数量        |
| enhanceLevel | Int     | 强化等级    |
| isIdentified | Boolean | 是否已鉴定  |
| customData   | Json?   | 自定义数据  |

### 2.6 玩家装备表 (PlayerEquipment)

玩家当前装备

| 字段        | 类型   | 说明                                  |
| ----------- | ------ | ------------------------------------- |
| id          | String | 主键                                  |
| playerId    | String | 玩家ID (FK)                           |
| slot        | Enum   | weapon/head/body/hands/feet/accessory |
| inventoryId | String | 背包物品ID (FK)                       |

---

### 2.7 召唤兽表 (Pet) - 静态配置

召唤兽模板

| 字段           | 类型     | 说明                        |
| -------------- | -------- | --------------------------- |
| id             | String   | 召唤兽ID                    |
| name           | String   | 名称                        |
| evolutionLine  | String   | 进化线 (如: turtle/serpent) |
| evolutionStage | Int      | 进化阶段 (1-4)              |
| baseHp         | Int      | 基础HP                      |
| baseAttack     | Int      | 基础攻击                    |
| baseDefense    | Int      | 基础防御                    |
| skillIds       | String[] | 可用技能ID列表              |

### 2.8 玩家召唤兽表 (PlayerPet)

玩家拥有的召唤兽

| 字段      | 类型    | 说明          |
| --------- | ------- | ------------- |
| id        | String  | 主键          |
| playerId  | String  | 玩家ID (FK)   |
| petId     | String  | 召唤兽ID (FK) |
| nickname  | String? | 昵称          |
| level     | Int     | 等级          |
| exp       | Int     | 经验值        |
| currentHp | Int     | 当前HP        |
| isActive  | Boolean | 是否出战      |

---

### 2.9 区域表 (Area) - 静态配置

区域模板

| 字段             | 类型     | 说明                   |
| ---------------- | -------- | ---------------------- |
| id               | String   | 区域ID                 |
| name             | String   | 区域名称               |
| type             | Enum     | ocean/land/town/secret |
| realmRequirement | String   | 境界要求               |
| baseDescription  | String   | 基础描述               |
| dungeonIds       | String[] | 副本ID列表             |
| bossIds          | String[] | BOSS ID列表            |

### 2.10 玩家区域记录表 (PlayerArea)

玩家对区域的探索记录

| 字段                | 类型     | 说明             |
| ------------------- | -------- | ---------------- |
| id                  | String   | 主键             |
| playerId            | String   | 玩家ID (FK)      |
| areaId              | String   | 区域ID (FK)      |
| firstVisitAt        | DateTime | 首次访问时间     |
| progress            | Int      | 探索进度 (0-100) |
| discoveredSecrets   | String[] | 已发现的秘密     |
| generatedBackground | Json     | AI生成的背景     |

---

### 2.11 图鉴表 (Collection)

玩家收集记录

| 字段         | 类型     | 说明                      |
| ------------ | -------- | ------------------------- |
| id           | String   | 主键                      |
| playerId     | String   | 玩家ID (FK)               |
| category     | Enum     | creature/item/skill/world |
| entryId      | String   | 条目ID                    |
| discoveredAt | DateTime | 发现时间                  |
| count        | Int      | 遇见次数                  |

---

### 2.12 战斗日志表 (BattleLog)

战斗历史记录

| 字段       | 类型     | 说明                    |
| ---------- | -------- | ----------------------- |
| id         | String   | 主键                    |
| playerId   | String   | 玩家ID (FK)             |
| battleType | Enum     | random/boss/story/tower |
| areaId     | String?  | 区域ID                  |
| enemyData  | Json     | 敌人数据                |
| result     | Enum     | victory/defeat/escape   |
| rounds     | Int      | 回合数                  |
| expGained  | Int      | 获得经验                |
| goldGained | Int      | 获得金币                |
| lootData   | Json?    | 掉落物品                |
| narrative  | String   | AI生成的战斗叙事        |
| createdAt  | DateTime | 战斗时间                |

---

### 2.13 剧本文档表 (Document)

玩家的境界/区域文档

| 字段        | 类型     | 说明           |
| ----------- | -------- | -------------- |
| id          | String   | 主键           |
| playerId    | String   | 玩家ID (FK)    |
| type        | Enum     | realm/area     |
| referenceId | String   | 境界名或区域ID |
| content     | Json     | 文档内容       |
| createdAt   | DateTime | 创建时间       |
| updatedAt   | DateTime | 更新时间       |

**境界文档 content 结构:**

- breakthroughConditions: 突破条件描述
- realmFeatures: 境界特性
- cultivationNotes: 修炼心得
- importantEvents: 重要事件列表
- customContent: 玩家自定义内容

**区域文档 content 结构:**

- backgroundStory: 背景故事
- coreConflict: 核心矛盾
- keyNpcs: 关键NPC
- factionRelations: 势力关系
- discoveredSecrets: 已发现秘密
- playerNotes: 玩家笔记

---

## 三、枚举定义

| 枚举名             | 值                                                        |
| ------------------ | --------------------------------------------------------- |
| SkillType          | active, field, passive                                    |
| Element            | water, fire, earth, wind, dark, light                     |
| TargetType         | single, aoe, self                                         |
| ItemType           | weapon, armor, accessory, consumable, material, skillbook |
| Quality            | common, uncommon, rare, epic, legendary, mythic           |
| EquipSlot          | weapon, head, body, hands, feet, accessory                |
| AreaType           | ocean, land, town, secret                                 |
| CollectionCategory | creature, item, skill, world                              |
| BattleType         | random, boss, story, tower                                |
| BattleResult       | victory, defeat, escape                                   |
| DocumentType       | realm, area                                               |

---

## 四、索引设计

| 表              | 索引字段                      | 类型     |
| --------------- | ----------------------------- | -------- |
| Player          | name                          | 唯一索引 |
| PlayerSkill     | playerId + skillId            | 复合唯一 |
| Inventory       | playerId + itemId             | 复合索引 |
| PlayerEquipment | playerId + slot               | 复合唯一 |
| PlayerPet       | playerId + isActive           | 复合索引 |
| PlayerArea      | playerId + areaId             | 复合唯一 |
| Collection      | playerId + category + entryId | 复合唯一 |
| BattleLog       | playerId + createdAt          | 复合索引 |
| Document        | playerId + type + referenceId | 复合唯一 |

---

## 五、静态数据说明

以下表为静态配置，数据存储在 JSON 文件或 seed 脚本中：

| 表    | 说明       | 数据来源                |
| ----- | ---------- | ----------------------- |
| Skill | 技能模板   | prisma/seed/skills.json |
| Item  | 物品模板   | prisma/seed/items.json  |
| Pet   | 召唤兽模板 | prisma/seed/pets.json   |
| Area  | 区域模板   | prisma/seed/areas.json  |

---

## 六、数据迁移考虑

1. **初始化脚本**: 运行 `prisma db seed` 导入静态数据
2. **版本迁移**: 使用 Prisma Migrate 管理 schema 变更
3. **数据备份**: 定期备份 PostgreSQL 到云存储

---

> 📝 详细 Prisma Schema 请参考: `prisma/schema.prisma`
