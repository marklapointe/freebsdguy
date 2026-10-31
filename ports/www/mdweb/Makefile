PORTNAME=	mdweb
DISTVERSION=	1.1.0
CATEGORIES=	www

MAINTAINER=	mark@cloudbsd.org
COMMENT=	Markdown personal website with React frontend and Express API
WWW=		https://github.com/marklapointe/freebsdguy

LICENSE=	MIT
LICENSE_FILE=	${WRKSRC}/LICENSE

# Distfile is placed in DISTDIR by scripts/freebsd-package-round.sh
MASTER_SITES=	file://${DISTDIR}/
DISTFILES=	${PORTNAME}-${DISTVERSION}${EXTRACT_SUFX}

USES=		nodejs:lts,build,run
USE_RC_SUBR=	mdweb

NO_ARCH=	yes

# npm major follows the selected Node LTS (nodejs.mk sets NODEJS_VERSION)
BUILD_DEPENDS=	npm-node${NODEJS_VERSION}>0:www/npm-node${NODEJS_VERSION}

WRKSRC=		${WRKDIR}/${PORTNAME}-${DISTVERSION}

ETCDIR=		${PREFIX}/etc/${PORTNAME}

# pkg-plist holds only static entries (@sample, @dir, man page). The vite build
# (hashed asset names) and node_modules are appended to the packing list in
# post-install, so `make package` is self-contained and the plist never drifts.

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
	# Ship full theme catalog into runtime themes dir
	cd ${WRKSRC}/server/themes && ${COPYTREE_SHARE} . ${STAGEDIR}/var/db/mdweb/themes
	${INSTALL_DATA} ${FILESDIR}/config.json.sample ${STAGEDIR}${ETCDIR}/
	${INSTALL_DATA} ${FILESDIR}/users.json.sample ${STAGEDIR}${ETCDIR}/
	${INSTALL_DATA} ${FILESDIR}/mdweb.env.sample ${STAGEDIR}${ETCDIR}/
	${INSTALL_MAN} ${WRKSRC}/mdweb.1 ${STAGEDIR}${PREFIX}/share/man/man1

post-install:
	@${FIND} ${STAGEDIR}${WWWDIR} \( -type f -o -type l \) \
		| ${SED} -e 's,^${STAGEDIR}${PREFIX}/,,' | ${SORT} >> ${TMPPLIST}
	@${FIND} ${STAGEDIR}/var/db/mdweb \( -type f -o -type l \) \
		| ${SED} -e 's,^${STAGEDIR},,' | ${SORT} >> ${TMPPLIST}

.include <bsd.port.mk>
