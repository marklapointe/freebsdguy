PORTNAME=	mdweb
DISTVERSION=	1.0.0
CATEGORIES=	www

MAINTAINER=	mark@cloudbsd.org
COMMENT=	Markdown personal website with React frontend and Express API
WWW=		https://github.com/marklapointe/freebsdguy

LICENSE=	MIT
LICENSE_FILE=	${WRKSRC}/LICENSE

# Distfile is placed in DISTDIR by scripts/freebsd-package-round.sh
MASTER_SITES=	file://${DISTDIR}/
DISTFILES=	${PORTNAME}-${DISTVERSION}${EXTRACT_SUFX}

USES=		nodejs:22,build,run
USE_RC_SUBR=	mdweb

NO_ARCH=	yes

BUILD_DEPENDS=	npm-node22>0:www/npm-node22

WRKSRC=		${WRKDIR}/${PORTNAME}-${DISTVERSION}

ETCDIR=		${PREFIX}/etc/${PORTNAME}

# pkg-plist is generated after stage via scripts/gen-plist.sh
# (node_modules is too large to maintain by hand)

do-build:
	@${ECHO_MSG} "===>  npm ci + build (frontend) + production prune"
	cd ${WRKSRC} && ${SETENV} ${MAKE_ENV} HOME=${WRKDIR} \
		npm ci
	cd ${WRKSRC} && ${SETENV} ${MAKE_ENV} HOME=${WRKDIR} \
		npm run build
	cd ${WRKSRC} && ${SETENV} ${MAKE_ENV} HOME=${WRKDIR} \
		npm prune --omit=dev
	# tsx is a production dependency (package.json) for running TypeScript server

do-install:
	@${MKDIR} ${STAGEDIR}${WWWDIR}
	@${MKDIR} ${STAGEDIR}${ETCDIR}
	@${MKDIR} ${STAGEDIR}/var/db/mdweb/posts/images
	@${MKDIR} ${STAGEDIR}/var/db/mdweb/themes
	cd ${WRKSRC}/dist && ${COPYTREE_SHARE} . ${STAGEDIR}${WWWDIR}/dist
	cd ${WRKSRC}/server && ${COPYTREE_SHARE} . ${STAGEDIR}${WWWDIR}/server
	${INSTALL_DATA} ${WRKSRC}/package.json ${STAGEDIR}${WWWDIR}
	${INSTALL_DATA} ${WRKSRC}/package-lock.json ${STAGEDIR}${WWWDIR}
	cd ${WRKSRC}/node_modules && ${COPYTREE_BIN} . ${STAGEDIR}${WWWDIR}/node_modules
	${INSTALL_DATA} ${WRKSRC}/server/posts/welcome.md \
		${STAGEDIR}/var/db/mdweb/posts/ 2>/dev/null || ${TRUE}
	${INSTALL_DATA} ${WRKSRC}/server/themes/dark.json \
		${STAGEDIR}/var/db/mdweb/themes/
	${INSTALL_DATA} ${WRKSRC}/server/themes/light.json \
		${STAGEDIR}/var/db/mdweb/themes/
	${INSTALL_DATA} ${FILESDIR}/config.json.sample ${STAGEDIR}${ETCDIR}/
	${INSTALL_DATA} ${FILESDIR}/users.json.sample ${STAGEDIR}${ETCDIR}/
	${INSTALL_DATA} ${FILESDIR}/mdweb.env.sample ${STAGEDIR}${ETCDIR}/
	${INSTALL_MAN} ${WRKSRC}/mdweb.1 ${STAGEDIR}${PREFIX}/share/man/man1

.include <bsd.port.mk>
