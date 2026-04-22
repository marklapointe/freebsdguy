PORTNAME=	MDWeb
DISTVERSION=	1.0.0
CATEGORIES=	www

MAINTAINER=	mlapointe@example.com
COMMENT=	FreeBSD Guy personal website (MDWeb)
WWW=		https://github.com/freebsdguy/freebsdguy

LICENSE=	MIT

USES=		nodejs:run

NO_BUILD=	yes
NO_ARCH=	yes

do-install:
	${MKDIR} ${STAGEDIR}${WWWDIR}
	(cd ${WRKSRC} && ${COPYTREE_SHARE} . ${STAGEDIR}${WWWDIR})

.include <bsd.port.mk>
