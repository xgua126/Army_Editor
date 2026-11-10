# -*- coding: utf-8 -*-
"""兵牌中文词表（供 tools/gen_ms_catalog.py 用）

格式：RAW 里一行一条 `English=中文;`（`;` 分隔，可以一行放多条）
      ↓ 空的（=`;`）表示这个词不译（the / and / of …）
      专门整条覆盖的放 PHRASES
"""
import re

RAW = """
-=; /=;
-General=通用
/=/; /Jammer=干扰型; /Remote=远程型; /Unmanned=无人型
1=一; 2=二; 3=三; 4=四; 5=五; 6=六; 7=七
APT=APT; ASW=反潜; ATM=ATM
Above=以上; Accident=事故; Acquisition=捕获; Activity=活动; Administration=行政
Administrative=行政; Adult=成人; Advanced=先进; Advisor=顾问; Advocate=倡导
Aerial=空中; Affairs=事务; Affairs/Graves=事务/墓地登记; Affairs/Public=事务/公共
Aftershock=余震; Agent=剂; Agriculture=农业; Air=空中; Air-Cushioned=气垫
Air/Land=空/陆; Airborne=空降; Aircraft=飞机; Airframe=机体; Airport=机场
Airport/Air=机场/空军; Airship=飞艇; Alcohol=酒精; Alcohol-Tobacco-Firearms=烟酒枪械
All=全部; Allied=盟军; Altitude=高度; Ambulance=救护车; Ammunition=弹药
Amphibious=两栖; Analysis=分析; Anchor=锚地; Animal=动物; Animals=动物
Antennae=天线; Anti-Ballistic=反导; Anti-torpedo=反鱼雷; Antiair=防空
Antipersonnel=杀伤人员; Antisatellite=反卫星; Antisubmarine=反潜; Antisurface=反舰
Antitank=反坦克; Antitank/Antiarmor=反坦克/反装甲; Applicable=适用; Approach=进近
Arctic=寒区; Area=区域; Armament=军械; Armory=军械库; Arms=武器; Army=陆军
Armor/Armored/Mechanized/Self-Propelled/Tracked=装甲/机械化/自行/履带
Armored=装甲; Armored/Mechanized/Tracked=装甲/机械化/履带
Arrest=逮捕; Arrow=箭头; Arson=纵火; Artillery=炮兵; Assassination=暗杀
Assault=突击; Asset=资产; Assistance=援助; Astronomical=天文; Atomic=原子
Attack=攻击; Attack/Strike=攻击/打击; Attempted=未遂; Automatic=自动; Automobile=汽车
Autonomous=自主; Auxiliary=辅助; Avalanche=雪崩; Aviation=航空; Aviation/Aviation=航空
Backhoe=挖掘装载机; Ballistic=弹道; Band=军乐队; Bank=岸; Banking=银行; Barge=驳船
Base=基地; Battle=战斗; Battleship=战列舰; Below=以下; Bicycle=自行车
Biological=生物; Biosatellite=生物卫星; Bird=禽类; Black=黑; Boat=艇; Body=主体
Bomb=炸弹; Bomb/Bombing=炸弹/轰炸; Bomber=轰炸机; Booby=诡雷; Boom=加油杆
Boom-Only=仅硬管; Border=边境; Botnet=僵尸网络; Bottom=海底
Bottom-Confidence-Level=底置信度; Box=箱式; Break=突破; Bridge=桥; Bridging=架桥
Broadcast=广播; Bullion=贵金属; Bureau=局; Burglary=入室盗窃; Bus=客车
C2=指挥控制; CBRN=核生化; Cache=藏匿点; Callback=回呼; Camp=营地; Cannon=火炮
Capsule=舱; Care=照护; Cargo=货运; Carrier=航母; Carrier-Recovery=回收航母
Casualty=伤亡; Cave=洞穴; Center=中心; Certain=确定; Channel=航道
Chaser/Escort=追逐/护航; Chassis=底盘; Chemical=化学
Chemical-Biological-Radiological=化生放; Child=儿童; Civil=民事; Civil-Military=军民
Civilian=民用; Class=类; Classes=各类; Classifier=分选; Cleared=已清; Clearing=清除
Close=近距; Coal=煤; Coast=海岸; Coerced/Impressed=被胁迫/被征用; Collection=收集
Collector=收集者; College/University=大专院校; Combat=战斗; Combatant=战斗人员
Combined=联合; Combustible=可燃; Command=指挥; Commercial=商业; Communication=通信
Communications=通信; Compact=紧凑; Composite=混编; Computer=计算机; Construction=建筑
Contact=接触; Container=集装箱; Contaminated=污染; Contingency=应急; Contractor=承包商
Control=控制; Convoy=车队; Cooperation=合作; Coordination=协调; Core=核心; Corps=军
Corrosive=腐蚀性; Corvette=轻型护卫舰; Counterintelligence=反情报
Countermeasure=对抗; Countermeasures=对抗; Country=国家; Craft=船艇; Craft/Yard=船艇/船厂
Crane/Loading=吊装; Crime=犯罪; Criminal=刑事; Cross=十字; Crowd=人群; Cruise=巡航
Cruiser=巡洋舰; Cultural=文化; Customs=海关
Dam=水坝; Damage=损坏; Data=数据; Day=日; Dead=死亡
Debarkation/Airport=卸载机场; Debarkation/Sea=卸载港口; Deck=甲板
Decontamination=洗消; Decoy=诱饵; Decoy-Bottom=海底诱饵; Decoy-Moored=锚泊诱饵
Defense=防御; Defenses=防御; Degradation=降级; Demolition=爆破; Demonstration=示威
Dental=牙科; Department=部; Deployment=部署; Destroyer=驱逐舰; Detention=拘留
Device=装置; Diesel=柴油; Digital=数字; Direct=直接; Direction=方向
Discharge=排放; Displaced=流离失所; Disposal=处置; Distribution=分发
Disturbance=骚乱; Dive=潜水; Diver=潜水员; Diving=潜水; Division=师; Dock=船坞
Dog=犬; Domain=域; Downlinked=下行; Dozer=推土机; Dozer-Armored=装甲推土机
Dredge=疏浚; Dredger=挖泥船; Drifter=漂流物; Drill=钻; Drilling=钻探
Drive-by=驾车射击; Drogue=锥套; Drogue-Only=仅软管; Drone=无人机
Drone-Equipped=无人机载; Drought=干旱; Drug=毒品; EMT=急救; Early=早期; Earth=地球
Earthmover=土方机械; Earthmover/Digger=土方/挖掘; Earthquake=地震; Echo=回声
Echo-Bottom=海底回声; Echo-Floating=漂浮回声; Echo-Moored=锚泊回声
Economic=经济; Educational=教育; Effect=效果; Elder=老人; Electric=电力
Electro-Optical=光电; Electronic=电子; Element=分队; Embarkation=装载
Emergency=应急; Emplaced=布设; Enclosed=封闭式; Enemy=敌方; Energy=能源
Enforcement=执法; Engineer=工兵; Engineering=工程; Enhanced=增强; Entrance=入口
Environmental=环境; Epicenter=震中; Equipment=装备; Equipped=配备; Eruption=喷发
Escort=护航; Europe=欧洲; Evacuation=后送; Evacuee=疏散人员; Evacuees=疏散人员
Event=事件; Eviction=驱逐; Evolved=演进; Exchange=交换; Execution=执行
Exercise=演习; Exfiltration=撤出; Expendable=消耗型; Exploitation=利用
Explosion=爆炸; Explosive=爆炸物; Explosives=爆炸物; Explosives/Assembly=爆炸物/组装
Extension=延伸; Extortion=勒索; Facilities=设施; Facility=设施; False=虚假
Farm/Ranch=农场/牧场; Fast=快速; Federal=联邦; Feedlot=饲养场; Ferry=渡船
Field=野战; Fighter=战斗机; Fighter/Bomber=战斗轰炸机; Fighting=战斗
Fighting/Fire=战斗/火力; File=文件; Finance=财务; Financial=金融; Find=发现
Finding=发现; Fire=火力; Firearms=枪械; Fires=火力; Firewall=防火墙; Fishing=渔业
Fixed=固定; Fixed-Wing=固定翼; Flag=旗帜; Flame=火焰; Flammable=易燃; Flatbed=平板
Floating=浮动; Floating-Confidence-Level=浮置信度; Flood=洪水; Folding=折叠
Food=食品; Foraging/Searching=觅食/搜寻; Force=部队; Forces=部队; Foreign=外国
Forward=前进; Found=已发现; Frequency=频率; Frigate=护卫舰; Fused=引信; Gang=团伙
Gas=气体; General=通用; General-Confidence-Level=总置信度; Generation=发电
Generator=发电机; Geologic=地质; Geospatial=地理空间; Geostationary=地球静止
Geosynchronous=地球同步; Geothermal=地热; Girder=桁架; Going=航行; Government=政府
Grade=级; Graffiti=涂鸦; Grain=粮食; Grave=墓; Gray=灰色; Grenade=榴弹; Ground=地面
Ground-Based=地基; Ground-based=地基; Group=群; Guard=警卫; Guided=制导; Gun=火炮
Gunfire=舰炮; Harbor=港口; Hazard=危险; Hazardous=危险; Headquarters=司令部
Health=卫生; Heavy=重型; Helicopter=直升机
Helicopter-Equipped/VSTOL=直升机/垂直短距起降; Helo=直升机; Herder=牧民; High=高
High-Altitude=高空; Hijacking=劫持; Hijacking/Highjacked=劫持; Hijacking/Hijacked=劫持
Hoax=骗局; Holding=收容; Hollow=空心; Home=本土; Hospital=医院; Host=宿主; Hot=热
House=房屋; House-to-House=逐屋; Hovercraft=气垫船; Howitzer=榴弹炮; Hunter=猎手
Hydrant=消防栓; Hydro-Meteorological=水文气象; Hydroelectric=水电; Hydrofoil=水翼船
I=我; IED=简易爆炸装置; II=二; III=三; IV=四; IX=九; Identification=识别
Illegal=非法; Imagery=图像; Impaired=受损; Important=重要; Improvised=简易
In-Flight=飞行中; Incendiary=燃烧; Incident=事件; Independent=独立; Individual=个人
Industrial=工业; Infantry=步兵; Infection=感染; Infectious=传染; Infestation=侵害
Infiltration=渗透; Inflatable=充气; Information=信息; Infrared=红外
Infrastructure=基础设施; Insect=昆虫; Inspection=检查; Installation=设施
Institution=机构; Insurance=保险; Insurgent=叛乱分子; Intake=取水口; Intelligence=情报
Intensive=重症; Intercept=侦收; Interceptor=拦截弹; Intercontinental=洲际
Intermediate=中程; Intermodal=多式联运; Internal=内部; International=国际
Interrogation=审讯; Interrogator=询问机; Intrusion=入侵; Inventory=库存
Investigation=调查; Jail=监狱; Jamming=干扰; Jeep=吉普; Jet=喷气; Joint=联合
Judge=军法; Junk/Dhow=帆船; Justice=司法; Kidnapping=绑架; Killing=杀害
Kingfisher=翠鸟; Known=已知; LAMPS=轻型机载多用途系统; Lab=实验室; Labor=劳务
Laboratory=实验室; Land=陆地; Lander=着陆器; Landfill=垃圾填埋场; Landing=登陆
Landslide=滑坡; Large=大型; Large/Heavy=大型/重型; Laser=激光; Lash=绑扎; Launch=发射
Launched=已发射; Launcher=发射装置; Launching=发射; Laundry/Bath=洗涤/淋浴; Law=法律
Layer=层; Laying=布设; Leader=领导人; Leadership=领导层; Leisure=休闲; Less=较; Liaison=联络
Lift=运输; Light=轻型; Lighter=较轻; Limited=有限; Line=线; Liquid=液体; List=清单
Littoral=濒海; Location=位置; Locomotive=机车; Logistics=后勤; Long=长; Long-Range=远程
Loot=抢劫; Loss=损失; Low=低; Lubricant=润滑油; Lubricants=润滑油; MILCO=军民协作
MISO=军事信息支援; Machine=机枪; Mail=邮件; Main=主; Maintenance=维修; Maneuver=机动
Manipulation=操纵; Manual=人工; Manufacture=制造; Manufacturer=制造商; Marine=陆战
Marketing=营销; Marshals=法警; Mass=大规模; Material=物资; Materials=物资; Materiel=器材
Mechanized=机械化; Medevac=医疗后送; Media=媒体; Medical=医疗; Medium=中型; Meeting=会议
Member=成员; Merchant=商船; Meteorological=气象; Microbial=微生物; Midcourse=中段
Midsize=中型; Military=军事; Mine=地雷; Mine-Bottom=沉底雷; Mine-Floating=漂雷
Mine-General=一般水雷; Mine-Like=疑似水雷; Mine-Moored=锚雷; Mine-Other=其他水雷
Mine-Rising=上浮雷; Mines=地雷; Miniaturized=微型; Missile=导弹; Missile-2=导弹-2
Missile-6=导弹-6; Mobile=机动; Mobile/Air=机动/空中; Mobility=机动性; Module=模块
Molniya=闪电轨道; Moored=锚泊; Moored-Confidence-Level=锚泊置信度; Morale=士气
Morgue=停尸房; Mortar=迫击炮; Mortuary=殡葬; Motorized=摩托化; Mountain=山地
Mounted=车载; Movement=运动; Multi-Channel=多信道; Multi-Mission=多任务
Multifunctional=多功能; Multimission=多任务; Multinational=多国; Multiple=多管
Multipurpose=多用途; Murder=谋杀; NAPT=NAPT; NATO=北约; Named=命名; Natural=自然
Naval=海军; Navigational=导航; Navy=海军; Needs=需; Negative=阴性; Network=网络
Neutralized=已中和; Node=节点; Non-Advanced=非先进; Non-Flammable=非易燃
Non-Government=非政府; Non-Mine=非水雷; Non-Residential=非住宅; Non-specified=未指明
Noncombatant=非战斗人员; Nongovernmental=非政府; Nonlethal=非致命; Nonsubmarine=非潜艇
Normal=正常; Not=不; Nuclear=核; Object=目标; Object-Bottom=海底目标
Object-Floating=漂浮目标; Object-Mine-Like=疑似水雷目标; Object-Moored=锚泊目标
Observation=观察; Observer=观察员; Obstructor=障碍物; Ocean=海洋; Oceanographic=海洋
Off=关闭; Office=办公室; Oil=石油; Oiler=油船; Oiler/Tanker=油船/加油船; On/Roll=滚装
Open=敞开; Open-Bed=敞篷; Operation=行动; Operations=行动; Optical=光学; Orbit=轨道
Orbiter=轨道器; Ordnance=军械; Organic=建制; Organization=组织; Origin=来源; Other=其他
Outage=中断; Outfall=排放口; Outpatient=门诊; Own=己方; Oxidizer=氧化剂; Pack=驮
Package=包; Passenger=客运; Patient=伤员; Patriot=爱国者; Patrol=巡逻; Patrolling=巡逻
Peer-to-Peer=对等; Peroxide=过氧化物; Persistent=持久; Person=人员; Personnel=人员
Persons=人员; Petroleum=石油; Petroleum-Oil=油料; Petroleum/Gas/Oil=油气
Pharmaceutical=药品; Pharmacy=药房; Phase=阶段; Photographic=照相; Physician=医师
Pickup=皮卡; Piloted=有人驾驶; Pipeline=管线; Piracy=海盗; Pirate=海盗
Place/Election=投票点; Planet=行星; Plant=工厂; Plunder=掠夺; Point=点; Poisoning=中毒
Police=警察; Polling=投票; Port=港口; Port/Naval=港口/海军基地; Position=位置
Possible=可能; Post=邮政; Postal=邮政; Power=电力; Powered=动力; Premature=提前
Preventive=预防; Printed=印刷; Prison=监狱; Private=私人; Probable=可能; Production=生产
Production/Assembly=生产/组装; Propaganda=宣传; Propagation=传播; Propane=丙烷
Propellant=推进剂; Propulsion=推进; Protected=受保护; Protection=防护
Psychological=心理; Public=公共; Pumping=泵站; Purification=净化; Quartermaster=军需
Radar=雷达; Radio=无线电; Radioactive=放射性; Radiological=辐射; Raid=袭击
Rail=铁路; Railcar=轨道车; Railhead=铁路终点站; Railhead/Railroad=铁路终点站/铁路
Railroad=铁路; Range=距离; Ranger=游骑兵; Ranging=测距; Ransack=洗劫; Rape=强奸
Rapid=快速; Re-Entry=再入; Reacquisition-Bottom=海底重捕; Reacquisition-Floating=漂浮重捕
Reacquisition-General=一般重捕; Reacquisition-Moored=锚泊重捕; Reaction=反应
Reactor=反应堆; Recoilless=无后坐力; Recon=侦察; Reconnaissance=侦察
Reconnaissance/Cavalry/Scout=侦察/骑兵/搜索; Recovery=回收; Recreation=休闲
Recreational=休闲; Recruit=新兵; Recruitment=招募; Refuel=加油; Refugee=难民
Registration=登记; Related=相关; Relay=中继; Release=释放; Religious=宗教; Remote=远程
Remotely=遥控; Repair=修理; Replacement=补充; Replenishment=补给; Report=报告
Reporting=报告; Rescue=搜救; Research=研究; Reserve=储备; Reservoir=水库
Residential=住宅; Rest=休息; Retail=零售; Retailer=零售商; Rifle=步枪; Rigid-Hull=硬壳
Riot=暴乱; Rioting=暴乱; Riverine=内河; Robbery=抢劫; Rock=岩石; Rocket=火箭; Rodent=鼠类
Role=级; Roll=滚装; Rolling=滚动; Rotary=旋翼; Rotary-Wing=旋翼; Router=路由器
SH-60R=SH-60R; SSNR=SSNR; Sabotage=破坏; Safe=安全; Sailing=航行; Satellite=卫星
School=学校; Sea=海; Sea-Base=海上基地; Sea-Based=海基; Search=搜索; Secret=秘密
Security=警戒; Sedan=轿车; Self=自; Self-Propelled=自行; Self-propelled=自行
Semi-Trailer=半挂; Semiautomatic=半自动; Sensor=传感器; Sensors=传感器; Served=被服务
Server=服务器; Service=服务; Services=服务; Services-Other=其他服务
Services/Airfield=服务/机场; Set=组; Shelter=掩蔽所; Ship=舰船; Shipments=运输批次
Shooter=射手; Shooting=射击; Shore=岸上; Short=短; Shot=射击; Shuttle=穿梭; Sight=瞄准具
Signal=通信; Signals=信号; Single=单; Site=场址; Ski=滑雪; Small=小型
Small/Light=小型/轻型; Smoke=烟幕; Smuggling=走私; Sniper=狙击手; Sniping=狙击
Solid=固体; Solution=解; Sound=声响; Space=太空; Sparrow=麻雀; Speaker=扬声器
Special=特种; Specialized=专门; Speedboat=快艇; Spontaneously=自发; Spoofing=欺骗
Sport=体育; Spot=现场; Spy=间谍; Staging=集结; Standard=标准; States=美国; Station=站
Status=状态; Stop=停车; Storage=储存; Stores=物资; Strategic=战略; Submarine=潜艇
Submarine-Bottomed=坐底潜艇; Submarine-Snorkeling=通气管潜艇
Submarine-Surfaced=水面潜艇; Submersible=可潜器; Subscriber=用户; Subsidence=沉降
Subsurface=水下; Suicide=自杀式; Supervisory=监视; Supply=补给; Support=支援
Support/Geospatial=支援/地理空间; Suppression=压制; Surface=水面
Surface-to-Surface=地地; Surveillance=监视; Survey=测绘; Suspicious=可疑
Sustainment=保障; Sweeper=清扫; Switch=交换机; System=系统; Systems=系统; TELAR=TELAR
TLAR=TLAR; TV=电视; Tactical=战术; Tactics=战术; Take-Off=起飞; Tank=坦克; Tanker=加油机
Target=目标; Targeted=被瞄准; Taser=电击枪; Task=任务; Team=小组
Telecommunications=电信; Telephone=电话; Teletype=电传; Television=电视; Tender=补给船
Tent=帐篷; Tented=帐篷式; Terminal=终端; Terrorist=恐怖分子; Tethered=系留
Theater/Echelons=战区/战区以上; Theft=盗窃; Threat=威胁; Thrower=发射器; Throwing=投掷
Tobacco=烟草; Toll=收费; Topographic=地形; Torpedo=鱼雷; Tow=拖曳; Towed=牵引; Tower=塔
Toxic=有毒; Track=航迹; Tracker=跟踪器; Tractor=牵引车; Traffic=交通; Trafficking=贩运
Trailer=拖车; Train=列车; Trainer=教练机; Training=训练; Transloader=转载车
Transmitter=发射机; Transport=运输; Transportation=运输; Transporter=运输车
Transporter-Launcher=运输发射车; Trap=陷阱; Trawler=拖网船; Treatment=治疗
Triage=检伤分类; Troop=部队; Truck=卡车; Tsunami=海啸; Tug=拖船; Tunnel=隧道; Type=型
UAV=无人机; US=美国; Ultra=超轻型; Underwater=水下; Unexploded=未爆; Unit=单位
United=合众; Unknown=未知; Unmanned=无人; Unspecified=未指定; Upgraded=升级; Utility=通用
V=五; VI=六; VII=七; VIII=八; VSTOL=垂直短距起降; VSTOL/VTOL=垂直短距起降
Valve=阀门; Van=厢式车; Vandalism=破坏公物; Vehicle=车辆; Vehicles=车辆; Venues=场所
Vertical=垂直; Vertical-Takeoff=垂直起降; Very=很; Vessel=舰船; Veterinary=兽医
Victim=受害者; Victims=受害者; Video=视频; Virtual=虚拟; Volcanic=火山; Volcano=火山
Warehouse/Storage=仓库/储存; Warfare=战; Warhead=弹头; Warning=警报; Warrant=逮捕令
Waste=废物; Wastewater=污水; Water=水; Weapon=武器; Weapon/Weapon=武器/武器系统
Weapons=武器; Weather=气象; Web=网络; Welfare=福利; Well=井; Wet=湿; Wheeled=轮式
White=白; Wild=野生; Willing=愿意; Wing=联队; Written=书面; X=X; X-Band=X波段; Yard=船厂
Zombie=僵尸; an=; and=; lethal=致命; of=; on=; or=; than=比; to=; when=当; with=配
Reptile=爬行动物; Lighter Than Air=轻于空气航空器; Lighter than Air=轻于空气航空器
"""

PHRASES_RAW = """
Military Lighter Than Air=军用轻于空气航空器; Civilian Lighter Than Air=民用轻于空气航空器
Military Lighter than Air=军用轻于空气航空器; Civilian Lighter than Air=民用轻于空气航空器
Air Defense=防空; Air Defence=防空; Air Defense Gun=防空炮
Air Defense Missile Launcher=防空导弹发射装置; Air Defense Missile=防空导弹
Military Police=宪兵; Special Forces=特种部队; Search and Rescue=搜救
Explosive Ordnance Disposal=爆炸物处理
Chemical Biological Radiological Nuclear Defense=化生放核防御
Multiple Rocket Launcher=多管火箭炮; Single Rocket Launcher=单管火箭炮
Armored Personnel Carrier=装甲人员输送车; Armored Fighting Vehicle=装甲战斗车辆
Main Gun System=主炮系统; Air Traffic Services/Airfield Operations=空中交通服务/机场运作
Combat Support (Maneuver Enhancement)=战斗支援（机动增强）
Army Aviation/Aviation Rotary Wing=陆军航空兵（旋翼）; Aviation Fixed Wing=固定翼航空
Aviation Composite=混编航空; Aviation Rotary Wing=旋翼航空
Sea Mine-General=水雷·通用; Sea Mine Decoy=水雷诱饵; Obstructor=障碍物
Mine-Like Echo (MILEC)-General=疑似水雷回波; Negative Reacquisition-General=负重捕
Non-Mine Mine-Like Object (NMLO)-General=非水雷疑似目标; General Mine Anchor=通用锚雷
Armor/Armored/Mechanized/Self-Propelled/Tracked=装甲兵; Armored/Mechanized/Tracked=装甲步兵
Reconnaissance/Cavalry/Scout=侦察兵; Special Operations Forces (SOF)=特种部队
Special Operations Forces=特种部队; Combined Arms=合成部队; Combat=战斗部队; Ground=地面部队
Marine=陆战队; Marine Division=陆战师; Sea Air Land (SEAL)=海豹突击队
Unmanned Aerial Systems=无人机系统; Military Information Support Operations (MISO)=军事信息支援行动
Fixed Wing=固定翼飞机; Rotary Wing=直升机; Aviation Rotary Wing=旋翼航空
Army Aviation/Aviation Rotary Wing=陆军航空兵
Air/Land Naval Gunfire Liaison=海空舰炮联络; Criminal Investigation Division=刑事调查分队
Explosive Ordnance Disposal (EOD)=爆炸物处理; Fire Fighting/Fire Protection=消防
Mine Clearing=扫雷; Mine Laying=布雷; Mine Launching=抛撒布雷
Security Police (Air)=空军警卫; Morale Welfare and Recreation=士气福利
Mortuary Affairs/Graves Registration=殡葬/墓地登记; Petroleum Oil and Lubricants=油料
Water Purification=净水; Public Affairs/Public Information=公共事务
Judge Advocate General=军法署; Airport of Debarkation/Airport of Embarkation=装卸机场
Sea Port of Debarkation/Sea Port of Embarkation=装卸港口; Railhead/Railroad Station=铁路终点站
Sea Port/Naval Base=港口/海军基地; Airport/Air Base=机场/空军基地
Traffic Inspection Facility=交通检查站; Wastewater Treatment Facility=污水处理厂
Surface Water Intake=地表取水口; Ground Water Well=地下水井; Storage Tower=储水塔
Control Valve=控制阀; Discharge Outfall=排放口; College/University=大专院校
Nuclear Material Production=核材料生产; Weapons Grade=武器级; Atomic Energy Reactor=核反应堆
Telecommunications Tower=通信塔; Bus Station=公交站; Ferry Terminal=轮渡码头
Rest Stop=休息站; Helicopter Landing Site=直升机起降场; Maintenance Facility=维修设施
Ship Yard=造船厂; Toll Facility=收费站; Military Armory=军械库; Military Base=军事基地
Postal Distribution Center=邮政分拣中心; Post Office=邮局
Fixed-Wing=固定翼; Rotary-Wing=旋翼; Attack/Strike=攻击
Corps Support=军级; Theater/Echelons Above Corps Support=战区级
US Supply Class I=一类补给（给养）; US Supply Class II=二类补给（被装）
US Supply Class III=三类补给（油料）; US Supply Class III Aviation=三类补给（航空油料）
US Supply Class IV=四类补给（工程材料）; US Supply Class V=五类补给（弹药）
US Supply Class VI=六类补给（个人用品）; US Supply Class VII=七类补给（主装备）
US Supply Class VIII=八类补给（医疗器材）; US Supply Class IX=九类补给（维修零件）
US Supply Class X=十类补给（非军用物资）
Water=供水; Water Purification=净水站; Medical Treatment Facility=医疗救治机构
Main Gun System=高炮系统; Short Range=近程; Combat Service Support=战斗勤务支援
"""


def _parse(raw, sep='=', empty_ok=True):
    out = {}
    for chunk in raw.replace('\n', ';').split(';'):
        chunk = chunk.strip()
        if not chunk or sep not in chunk:
            continue
        k, v = chunk.split(sep, 1)
        k = k.strip()
        out[k] = v.strip()
        out.setdefault(k.lower(), v.strip())
    return out


ZH_WORDS = _parse(RAW)
ZH_PHRASES = _parse(PHRASES_RAW)
